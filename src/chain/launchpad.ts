// The agent's side of Orbio's agent launchpad.
//
// A launch pairs the project token with $ORBIO on Pons and gives the agent a vault position.
// Creator fees from trading are collected, the vault keeps its share, and the rest is staked as
// $ORBIO. That stake earns $CREDIT, which the agent claims for itself and spends on inference.
//
// The vault's ABI is not published, so the calls below were read off the deployed implementation
// (a UUPS proxy at VAULT) and confirmed against the launch receipt. Everything here is read-only
// except `claim`, which moves nothing but the agent's own rewards.
import { createWalletClient, parseAbi, type Hex } from 'viem'
import { LAUNCHPAD } from '../config.js'
import { log } from '../core/log.js'
import { CONTRACTS, ROBINHOOD, publicClient, transport, treasuryAccount, txUrl } from './refuel.js'

export const VAULT = '0x0E1651aEC67B2a049a4FA6aEb6C1c305aabfc35b' as const

export const VAULT_ABI = parseAbi([
  'function agentIdOf(address token) view returns (uint256)',
  'function agentOf(uint256 id) view returns (address token, address receiver, address owner, address agentWallet, address beneficiary, uint256 launchedAt, uint16 feeBps, uint256 configId, uint256 staked, int256 rewardDebt, uint256 accrued, uint256 spare)',
  'function stakeOf(uint256 id) view returns (uint256)',
  'function unlocksAt(uint256 id) view returns (uint256)',
  'function recipientOf(uint256 id) view returns (address)',
  'function receiverFor(uint256 id) view returns (address)',
  'function feeBps() view returns (uint16)',
  'function CLIFF() view returns (uint256)',
  'function harvest(uint256[] ids)',
  'function claim()',
])

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])

export interface LaunchPosition {
  agentId: number
  token: string
  /** Where creator fees are collected for this launch. */
  receiver: string
  /** Who may withdraw principal after the cliff. */
  owner: string
  /** The wallet that claims, and where CREDIT lands. */
  agentWallet: string
  /** ORBIO staked for this agent, whole tokens. */
  stakedOrbio: number
  /** Unactivated CREDIT sitting in the agent's wallet, in dollars of inference. */
  creditHeld: number
  /** When the owner may start withdrawing principal. */
  unlocksAt: string
  vaultFeeBps: number
  at: string
}

export const launchConfigured = () => Boolean(LAUNCHPAD.token)

/** Reads this agent's launch position. Cheap, read-only, and safe to call on every scan. */
export async function readLaunch(): Promise<LaunchPosition | null> {
  const token = LAUNCHPAD.token as Hex | null
  if (!token) return null

  const agentId = await publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'agentIdOf', args: [token] })
  if (agentId === 0n) return null

  const [agent, staked, unlocks, fee] = await Promise.all([
    publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'agentOf', args: [agentId] }),
    publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'stakeOf', args: [agentId] }),
    publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'unlocksAt', args: [agentId] }),
    publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'feeBps' }),
  ])
  const beneficiary = agent[4]
  const creditHeld = await publicClient
    .readContract({ address: CONTRACTS.credit, abi: ERC20, functionName: 'balanceOf', args: [beneficiary] })
    .catch(() => 0n)

  return {
    agentId: Number(agentId),
    token,
    receiver: agent[1],
    owner: agent[2],
    agentWallet: beneficiary,
    stakedOrbio: Number(staked) / 1e18,
    creditHeld: Number(creditHeld) / 1e6,
    unlocksAt: new Date(Number(unlocks) * 1000).toISOString(),
    vaultFeeBps: Number(fee),
    at: new Date().toISOString(),
  }
}

/**
 * Claims whatever CREDIT the stake has earned, for the agent's own wallet.
 *
 * Rewards settle by the hour, so most calls have nothing to claim and revert; that is ordinary and
 * is reported as `nothing`, not as a failure. Nothing here can touch the staked principal: only the
 * launching wallet may withdraw that, and only after the cliff.
 */
export async function claimCredit(): Promise<{ claimed: number; tx: string } | { claimed: 0; nothing: true }> {
  const account = treasuryAccount()
  if (!account) throw new Error('no agent wallet configured (AGENT_WALLET_PRIVATE_KEY)')

  const before = await publicClient.readContract({ address: CONTRACTS.credit, abi: ERC20, functionName: 'balanceOf', args: [account.address] })
  try {
    await publicClient.simulateContract({ address: VAULT, abi: VAULT_ABI, functionName: 'claim', account })
  } catch {
    return { claimed: 0, nothing: true }
  }

  const wallet = createWalletClient({ account, chain: ROBINHOOD, transport: transport() })
  const hash = await wallet.writeContract({ address: VAULT, abi: VAULT_ABI, functionName: 'claim' })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') throw new Error(`claim reverted (${hash})`)

  const after = await publicClient.readContract({ address: CONTRACTS.credit, abi: ERC20, functionName: 'balanceOf', args: [account.address] })
  const claimed = Number(after - before) / 1e6
  log('FUEL', `launchpad claim: ${claimed ? `+${claimed.toFixed(6)} CREDIT to ${account.address}` : 'claimed, activated by the vault'} · ${txUrl(hash)}`)
  return { claimed, tx: hash }
}
