// Compiles contracts/HunchPay.sol and writes src/chain/hunchpay.json (ABI + bytecode), which the
// deploy script and the agent read. Run it after any change to the contract.
import { readFileSync, writeFileSync } from 'node:fs'
import solc from 'solc'

const SOURCE = new URL('../../contracts/HunchPay.sol', import.meta.url)
const OUT = new URL('../chain/hunchpay.json', import.meta.url)

const input = {
  language: 'Solidity',
  sources: { 'HunchPay.sol': { content: readFileSync(SOURCE, 'utf8') } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors ?? []) as { severity: string; formattedMessage: string }[]
for (const e of errors) console.log(e.formattedMessage.trim())
if (errors.some((e) => e.severity === 'error')) process.exit(1)

const contract = output.contracts['HunchPay.sol'].HunchPay
const artifact = {
  contract: 'HunchPay',
  compiler: solc.version(),
  compiledAt: new Date().toISOString(),
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
}
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`)
console.log(`HunchPay compiled with ${artifact.compiler}`)
console.log(`bytecode ${(artifact.bytecode.length / 2 - 1).toLocaleString()} bytes → ${OUT.pathname.split('/').pop()}`)
