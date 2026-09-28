// Deploys contracts/HunchPay.sol to Robinhood Chain from the agent's own wallet, and prints the
// address to set as HUNCH_PAY_CONTRACT. Run `npm run pay:build` first.
//
// This spends gas from the treasury (a few ten-thousandths of an ETH) and is not reversible: the
// operator runs it, deliberately, not the agent.
import { readFileSync } from 'node:fs'
import { createWalletClient, formatEther, type Hex } from 'viem'
import '../env.js'
import { CONTRACTS, ROBINHOOD, addressUrl, publicClient, treasuryAccount, txUrl } from '../chain/refuel.js'

const artifact = JSON.parse(readFileSync(new URL('../chain/hunchpay.json', import.meta.url), 'utf8')) as {
  abi: unknown[]
  bytecode: Hex
  compiler: string
}

async function main(): Promise<number> {
const account = treasuryAccount()
if (!account) {
  console.error('No AGENT_WALLET_PRIVATE_KEY, so there is no wallet to deploy from.')
  return 1
}

const balance = await publicClient.getBalance({ address: account.address })
console.log(`wallet   ${account.address} · ${formatEther(balance)} ETH`)
console.log(`treasury ${account.address} (payments land here)`)
console.log(`accepts  USDG ${CONTRACTS.usdg}`)
console.log(`compiler ${artifact.compiler}`)

if (balance === 0n) {
  console.error('That wallet holds no ETH, so it cannot pay gas.')
  return 1
}

if (!process.argv.includes('--yes')) {
  console.log('\nThis deploys a contract on chain 4663 and spends gas. Re-run with --yes to do it.')
  return 0
}

const wallet = createWalletClient({ account, chain: ROBINHOOD, transport: publicClient.transport as never })
const hash = await wallet.deployContract({
  abi: artifact.abi as never,
  bytecode: artifact.bytecode,
  args: [account.address, CONTRACTS.usdg],
})
console.log(`\ndeploying… ${txUrl(hash)}`)

const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
if (receipt.status !== 'success' || !receipt.contractAddress) {
  console.error(`the deployment failed (${receipt.status})`)
  return 1
}

const gasEth = formatEther(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n))
console.log(`\nHunchPay is live at ${receipt.contractAddress}`)
console.log(`${addressUrl(receipt.contractAddress)}`)
console.log(`gas ${receipt.gasUsed} (${gasEth} ETH)`)
console.log('\nSet this on the agent, locally and on Railway:')
console.log(`  HUNCH_PAY_CONTRACT=${receipt.contractAddress}`)
  return 0
}

process.exitCode = await main()
