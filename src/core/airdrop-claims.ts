import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createWalletClient, decodeEventLog, formatUnits, isAddress, keccak256, parseAbi, parseUnits, verifyMessage, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { AIRDROP, AirdropError, airdropReviewEntries } from './airdrop.js'
import { DATA_DIR, readJson, writeJson } from './store.js'
import { PUBLIC_URL } from '../config.js'
import { publicClient, ROBINHOOD, transport } from '../chain/refuel.js'

const fail = (message: string): never => { throw new AirdropError(message) }
const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)'])
type Reward = { wallet: string; handle: string; usdCents: number; amountHunch: string; rawTx?: Hex; txHash?: Hex; confirmed?: boolean }
type Campaign = { priceUsd: string; totalHunch?: string; rewards: Reward[]; enabled: boolean }
const campaign = () => readJson<Campaign>('airdrop-claim-allocations.json', { priceUsd: '', rewards: [], enabled: false })
const account = () => {
  const saved = readJson<{ privateKey: Hex } | null>('airdrop-treasury-secret.json', null)
  return saved ? privateKeyToAccount(saved.privateKey) : null
}
export function initializeClaimTreasury() {
  if (!account()) {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(join(DATA_DIR, 'airdrop-treasury-secret.json'), JSON.stringify({ privateKey: generatePrivateKey() }), { mode: 0o600, flag: 'wx' })
  }
  return { address: account()!.address, chainId: AIRDROP.chainId, token: AIRDROP.token }
}
export async function claimTreasuryStatus() {
  const treasury = account()
  if (!treasury) return { address: null, funded: false }
  const config = campaign()
  const [balance, gas] = await Promise.all([
    publicClient.readContract({ address: AIRDROP.token as Address, abi, functionName: 'balanceOf', args: [treasury.address] }),
    publicClient.getBalance({ address: treasury.address }),
  ])
  const owed = config.rewards.filter(r => !r.confirmed).reduce((sum, r) => sum + parseUnits(r.amountHunch, 18), 0n)
  return { address: treasury.address, balanceHunch: formatUnits(balance, 18), requiredHunch: formatUnits(owed, 18), gasEth: formatUnits(gas, 18), funded: owed > 0n && balance >= owed && gas > 0n, enabled: config.enabled }
}
// Fixed conversion and the entire reviewed USD ledger are installed together, before claims open.
export function configureClaims(body: unknown) {
  if (executing) return fail('A claim is processing. Wait before changing configuration.')
  const input = body as { priceUsd?: unknown; totalHunch?: unknown; rewards?: unknown; enabled?: unknown }
  const previous = campaign()
  if (previous.enabled || previous.rewards.some(r => r.txHash)) return fail('Close claims before configuration; allocations with transactions cannot change.')
  let pool: bigint | undefined
  if (input.totalHunch !== undefined) {
    if (input.priceUsd !== undefined || typeof input.totalHunch !== 'string' || !/^\d{1,15}(\.\d{1,18})?$/.test(input.totalHunch) || parseUnits(input.totalHunch, 18) <= 0n) return fail('Provide a positive fixed HUNCH pool, without a price.')
    pool = parseUnits(input.totalHunch, 18)
  } else if (typeof input.priceUsd !== 'string' || !/^\d{1,12}(\.\d{1,18})?$/.test(input.priceUsd) || parseUnits(input.priceUsd, 18) <= 0n) return fail('Provide a positive fixed USD price per HUNCH.')
  if (!Array.isArray(input.rewards) || input.rewards.length !== 26) return fail('Provide the full 26-recipient reviewed allocation ledger.')
  const entries = airdropReviewEntries()
  const rewards: Reward[] = input.rewards.map((row: { handle?: unknown; usdCents?: unknown }) => {
    if (typeof row.handle !== 'string' || typeof row.usdCents !== 'number' || !Number.isSafeInteger(row.usdCents) || row.usdCents <= 0) return fail('Invalid allocation row.')
    const handle = row.handle.replace(/^@/, '').toLowerCase()
    const entry = entries.find(e => e.handle === handle)
    if (!entry || handle === 'mrlarry100x' || handle === 'mrbankalart') return fail('This account is not in the reviewed recipient list.')
    const exception = ['bywrny', '7teen_wtf'].includes(handle)
    if (exception ? row.usdCents !== 500 : row.usdCents < 1000 || !entry.posts.length || entry.status === 'rejected') return fail('Allocation does not match the base or reply exception rules.')
    const atoms = pool !== undefined ? pool * BigInt(row.usdCents) / 50000n : BigInt(row.usdCents) * 10n ** 36n / (100n * parseUnits(input.priceUsd as string, 18))
    if (atoms <= 0n) return fail('HUNCH allocation is too small.')
    return { wallet: entry.wallet, handle, usdCents: row.usdCents, amountHunch: formatUnits(atoms, 18) }
  })
  if (new Set(rewards.map(r => r.wallet)).size !== 26 || new Set(rewards.map(r => r.handle)).size !== 26 || rewards.reduce((sum, r) => sum + r.usdCents, 0) !== 50000) return fail('Allocations must be unique and total exactly 500 USD.')
  if (pool !== undefined) {
    const remainder = pool - rewards.reduce((sum, r) => sum + parseUnits(r.amountHunch, 18), 0n)
    for (let i = 0; i < Number(remainder); i++) rewards[i].amountHunch = formatUnits(parseUnits(rewards[i].amountHunch, 18) + 1n, 18)
  }
  writeJson('airdrop-claim-allocations.json', { priceUsd: input.priceUsd ?? '', totalHunch: input.totalHunch, rewards, enabled: false })
  return { recipients: rewards.length, allocationBasisUsd: 500, priceUsd: input.priceUsd, totalHunch: input.totalHunch, claimsOpen: false }
}
export async function setClaimsEnabled(enabled: unknown) {
  if (typeof enabled !== 'boolean') return fail('Provide enabled as a boolean.')
  if (enabled && !(await claimTreasuryStatus()).funded) return fail('Fund all outstanding HUNCH allocations and ETH for gas before opening claims.')
  const config = campaign()
  config.enabled = enabled
  writeJson('airdrop-claim-allocations.json', config)
  return { claimsOpen: enabled }
}
export function claimCampaignStatus() { return { claimsOpen: campaign().enabled, treasury: account()?.address ?? null, followAccounts: ['hunchmode', '_ValeriusX'], followVerification: 'declaration' } }
export function claimAllocation(wallet: string) {
  const config = campaign()
  const reward = config.rewards.find(r => r.wallet === wallet.toLowerCase())
  return reward ? { amountHunch: reward.amountHunch, amountUsd: (reward.usdCents / 100).toFixed(2), status: reward.confirmed ? 'claimed' : reward.txHash ? 'processing' : 'approved', claimTx: reward.confirmed ? reward.txHash : null } : null
}
const challenges = new Map<string, { wallet: string; handle: string; amount: string; message: string; expires: number }>()
export function checkClaimPair(body: unknown) {
  const input = body as { wallet?: unknown; handle?: unknown }
  if (typeof input.wallet !== 'string' || !isAddress(input.wallet) || typeof input.handle !== 'string') return fail('Connect your registered wallet and enter your X handle.')
  const handle = input.handle.trim().replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return fail('Enter a valid registered X handle.')
  const reward = campaign().rewards.find(r => r.wallet === (input.wallet as string).toLowerCase())
  if (!reward) return fail('This wallet is not eligible for this airdrop.')
  if (reward.handle !== handle) return fail('Wallet and X handle do not match. Use the X handle registered with this wallet.')
  return { matches: true, handle, allocation: claimAllocation(reward.wallet) }
}
export function claimChallenge(body: unknown) {
  const input = body as { wallet?: unknown; handle?: unknown; follows?: unknown }
  if (!campaign().enabled) return fail('Claims are not open yet.')
  if (typeof input.wallet !== 'string' || !isAddress(input.wallet) || typeof input.handle !== 'string') return fail('Connect your original wallet and enter your X handle.')
  if (input.follows !== true) return fail('Follow @hunchmode and @_ValeriusX and confirm before claiming.')
  const wallet = input.wallet.toLowerCase(), handle = input.handle.trim().replace(/^@/, '').toLowerCase()
  const reward = campaign().rewards.find(r => r.wallet === wallet && r.handle === handle)
  if (!reward) return fail('This wallet and X handle do not match an approved allocation.')
  if (reward.confirmed) return fail('This allocation has already been claimed.')
  for (const [id, c] of challenges) if (c.expires < Date.now()) challenges.delete(id)
  if (challenges.size >= 1000) return fail('Claims are busy. Try again shortly.')
  const id = randomUUID(), expires = Date.now() + 600000
  const message = ['Claim Hunch supporter reward', `Website: ${PUBLIC_URL}`, `Campaign: ${AIRDROP.id}`, `Chain: ${AIRDROP.chainId}`, `Token: ${AIRDROP.token}`, `Wallet: ${wallet}`, `X account: @${handle}`, `Reward: ${reward.amountHunch} HUNCH`, 'I declare I follow @hunchmode and @_ValeriusX.', `Nonce: ${id}`, `Expires: ${new Date(expires).toISOString()}`, 'This signature requests your fixed reward. No token approval or wallet payment is required.'].join('\n')
  challenges.set(id, { wallet, handle, amount: reward.amountHunch, message, expires })
  return { id, message }
}
let executing = false
export async function executeClaim(body: unknown) {
  const input = body as { id?: unknown; signature?: unknown }
  if (typeof input.id !== 'string' || typeof input.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return fail('Provide a valid claim signature.')
  const challenge = challenges.get(input.id)
  if (!challenge || challenge.expires < Date.now()) return fail('Claim signature expired. Try again.')
  if (!await verifyMessage({ address: challenge.wallet as Address, message: challenge.message, signature: input.signature as Hex }).catch(() => false)) return fail('The signature does not match your original wallet.')
  if (executing) return fail('Another payout is processing. Try again shortly.')
  executing = true
  try {
    const config = campaign()
    if (!config.enabled) return fail('Claims are not open yet.')
    const reward = config.rewards.find(r => r.wallet === challenge.wallet && r.handle === challenge.handle && r.amountHunch === challenge.amount)
    if (!reward || reward.confirmed || !challenges.has(input.id)) return fail('This allocation changed or was already claimed.')
    // Never allocate a new nonce while any durable transfer remains unresolved, including after restart.
    const pending = config.rewards.find(r => r.txHash && !r.confirmed)
    if (pending && pending !== reward) return fail('A treasury payout is awaiting confirmation. Try again shortly.')
    const treasury = account()
    if (!treasury) return fail('The airdrop treasury is not configured.')
    const client = createWalletClient({ account: treasury, chain: ROBINHOOD, transport: transport() })
    if (!reward.rawTx) {
      const balance = await publicClient.readContract({ address: AIRDROP.token as Address, abi, functionName: 'balanceOf', args: [treasury.address] })
      const amount = parseUnits(reward.amountHunch, 18)
      if (balance < amount) return fail('Treasury funding is not yet sufficient. Try again later.')
      const { request, result } = await publicClient.simulateContract({ account: treasury, address: AIRDROP.token as Address, abi, functionName: 'transfer', args: [reward.wallet as Address, amount] })
      if (result !== true) return fail('The token transfer could not be simulated.')
      const prepared = await client.prepareTransactionRequest({ to: request.address, data: (await import('viem')).encodeFunctionData({ abi, functionName: 'transfer', args: [reward.wallet as Address, amount] }) })
      reward.rawTx = await client.signTransaction(prepared)
      reward.txHash = keccak256(reward.rawTx)
      writeJson('airdrop-claim-allocations.json', config)
    }
    // Retries broadcast the exact same signed transfer, never a second payout.
    await client.sendRawTransaction({ serializedTransaction: reward.rawTx }).catch(() => undefined)
    const receipt = await publicClient.waitForTransactionReceipt({ hash: reward.txHash!, confirmations: 6, timeout: 45000 }).catch(() => null)
    if (!receipt) return { status: 'processing', message: 'Your payout is awaiting confirmation. Use Check claim to resume safely.' }
    if (receipt.status !== 'success') return fail('The payout failed on chain. Contact @hunchmode; no reward has been marked claimed.')
    const events = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])
    let received = 0n
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== AIRDROP.token.toLowerCase()) continue
      try {
        const event = decodeEventLog({ abi: events, data: log.data, topics: log.topics })
        if (event.args.from.toLowerCase() === treasury.address.toLowerCase() && event.args.to.toLowerCase() === reward.wallet) received += event.args.value
      } catch { /* Ignore unrelated logs. */ }
    }
    if (received !== parseUnits(reward.amountHunch, 18)) return fail('The receipt does not prove the exact reward transfer. Contact @hunchmode.')
    reward.confirmed = true
    writeJson('airdrop-claim-allocations.json', config)
    challenges.delete(input.id)
    return { status: 'claimed', allocation: claimAllocation(reward.wallet) }
  } finally { executing = false }
}
