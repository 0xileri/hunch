// Hands HunchPay's ownership to another address. The owner can change the treasury and the list of
// accepted tokens, so it belongs on a colder wallet than the agent's running key.
//
// Irreversible from this side: once moved, only the new owner can move it back.
import { createWalletClient, isAddress, parseAbi, type Hex } from 'viem'
import '../env.js'
import { WATCH } from '../config.js'
import { ROBINHOOD, publicClient, transport, treasuryAccount, txUrl } from '../chain/refuel.js'

const ABI = parseAbi([
  'function owner() view returns (address)',
  'function treasury() view returns (address)',
  'function setOwner(address owner_)',
])

async function main(): Promise<number> {
  const next = process.argv[2]
  const pay = WATCH.contract as Hex | null
  const account = treasuryAccount()
  if (!next || !isAddress(next)) {
    console.error('usage: tsx src/scripts/pay-owner.ts <new owner address> [--yes]')
    return 1
  }
  if (!pay || !account) {
    console.error('needs HUNCH_PAY_CONTRACT and AGENT_WALLET_PRIVATE_KEY')
    return 1
  }

  const [owner, treasury] = await Promise.all([
    publicClient.readContract({ address: pay, abi: ABI, functionName: 'owner' }),
    publicClient.readContract({ address: pay, abi: ABI, functionName: 'treasury' }),
  ])
  console.log(`contract  ${pay}`)
  console.log(`owner     ${owner}${owner.toLowerCase() === account.address.toLowerCase() ? ' (this wallet)' : ''}`)
  console.log(`treasury  ${treasury} (unchanged by this)`)
  console.log(`new owner ${next}`)

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error('\nThis wallet is not the owner, so it cannot hand ownership on.')
    return 1
  }
  if (!process.argv.includes('--yes')) {
    console.log('\nRe-run with --yes to move ownership. Only the new owner can move it back.')
    return 0
  }

  const wallet = createWalletClient({ account, chain: ROBINHOOD, transport: transport() })
  const hash = await wallet.writeContract({ address: pay, abi: ABI, functionName: 'setOwner', args: [next as Hex] })
  console.log(`\nmoving… ${txUrl(hash)}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') {
    console.error('the transaction reverted')
    return 1
  }
  const now = await publicClient.readContract({ address: pay, abi: ABI, functionName: 'owner' })
  console.log(`owner is now ${now}`)
  return now.toLowerCase() === next.toLowerCase() ? 0 : 1
}

process.exitCode = await main()
