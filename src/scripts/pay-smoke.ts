// A live smoke test of the payment rail: approve a little USDG, fund a watch through HunchPay, and
// let the agent pick the payment up on its next scan. The treasury pays itself, so the only real
// cost is gas. Pass the watch id and an amount in USDG.
import { createWalletClient, parseAbi, parseUnits, type Hex } from 'viem'
import '../env.js'
import { WATCH } from '../config.js'
import { CONTRACTS, ROBINHOOD, publicClient, transport, treasuryAccount, txUrl } from '../chain/refuel.js'
import { PAY_ABI, watchIdToBytes32 } from '../chain/payments.js'

const ERC20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])

async function main(): Promise<number> {
  const watchId = process.argv[2]
  const usdg = process.argv[3] ?? '0.1'
  if (!watchId) {
    console.error('usage: tsx src/scripts/pay-smoke.ts <watchId> [usdg]')
    return 1
  }
  const account = treasuryAccount()
  const pay = WATCH.contract as Hex | null
  if (!account || !pay) {
    console.error('needs AGENT_WALLET_PRIVATE_KEY and HUNCH_PAY_CONTRACT')
    return 1
  }

  const amount = parseUnits(usdg, 6)
  const balance = await publicClient.readContract({ address: CONTRACTS.usdg, abi: ERC20, functionName: 'balanceOf', args: [account.address] })
  console.log(`wallet ${account.address} holds ${Number(balance) / 1e6} USDG`)
  if (balance < amount) {
    console.error('not enough USDG for the test')
    return 1
  }

  const wallet = createWalletClient({ account, chain: ROBINHOOD, transport: transport() })
  const allowance = await publicClient.readContract({ address: CONTRACTS.usdg, abi: ERC20, functionName: 'allowance', args: [account.address, pay] })
  if (allowance < amount) {
    const approveTx = await wallet.writeContract({ address: CONTRACTS.usdg, abi: ERC20, functionName: 'approve', args: [pay, amount] })
    console.log(`approve ${txUrl(approveTx)}`)
    await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 120_000 })
  }

  const fundTx = await wallet.writeContract({
    address: pay,
    abi: PAY_ABI,
    functionName: 'fund',
    args: [watchIdToBytes32(watchId), CONTRACTS.usdg as Hex, amount],
  })
  console.log(`fund    ${txUrl(fundTx)}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: fundTx, timeout: 120_000 })
  console.log(`${receipt.status} · gas ${receipt.gasUsed} · ${receipt.logs.length} logs`)
  console.log(`\n${usdg} USDG paid into ${watchId}. The agent credits it on its next scan.`)
  return receipt.status === 'success' ? 0 : 1
}

process.exitCode = await main()
