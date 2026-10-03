import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, parseTransaction } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const directory = mkdtempSync(join(tmpdir(), 'hunch-claims-'))
process.env.DATA_DIR = directory
const broadcasts: string[] = []
const rpc = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    const payload = JSON.parse(body)
    if (payload.method === 'eth_sendRawTransaction') broadcasts.push(payload.params[0])
    response.setHeader('content-type', 'application/json')
    const result = payload.method === 'eth_sendRawTransaction' ? keccak256(payload.params[0])
      : payload.method === 'eth_getBlockByNumber' ? { number: '0x69', hash: '0x' + '1'.repeat(64), baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x0', timestamp: '0x1', transactions: [] }
      : payload.method === 'eth_estimateGas' ? '0xc350'
      : payload.method === 'eth_getTransactionCount' ? '0x1'
      : payload.method === 'eth_maxPriorityFeePerGas' || payload.method === 'eth_gasPrice' ? '0x3b9aca00'
      : '0x1237'
    response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }))
  })
})
await new Promise<void>(resolve => rpc.listen(0, '127.0.0.1', resolve))
const rpcAddress = rpc.address() as { port: number }
process.env.ROBINHOOD_RPC_URLS = `http://127.0.0.1:${rpcAddress.port}`
const accounts = Array.from({ length: 26 }, () => privateKeyToAccount(generatePrivateKey()))
const entries = accounts.map((account, i) => ({ id: String(i), wallet: account.address.toLowerCase(), handle: i === 24 ? 'bywrny' : i === 25 ? '7teen_wtf' : `backer${i}`, status: i > 23 ? 'rejected' : 'pending', posts: i > 23 ? [] : [{ id: String(i), url: '', publishedAt: '' }], verificationCode: '', submittedAt: '' }))
writeFileSync(join(directory, 'airdrop-supporters.json'), JSON.stringify(entries))
const claims = await import('../core/airdrop-claims.js')
const publicClient = claims.claimPublicClient
const rewards = entries.map((entry, i) => ({ handle: entry.handle, usdCents: i === 0 ? 26000 : i > 23 ? 500 : 1000 }))
try {
  const treasury = claims.initializeClaimTreasury()
  assert.equal(claims.initializeClaimTreasury().address, treasury.address)
  assert.ok(!JSON.stringify(treasury).includes('privateKey'))
  assert.equal(claims.claimCampaignStatus().claimsOpen, false)
  assert.throws(() => claims.configureClaims({ priceUsd: '0', rewards }), /positive/)
  assert.throws(() => claims.configureClaims({ priceUsd: '0.01', rewards: rewards.map((r, i) => i === 25 ? rewards[24] : r) }), /unique/)
  assert.throws(() => claims.configureClaims({ priceUsd: '0.01', rewards: rewards.map((r, i) => i === 0 ? { ...r, usdCents: 26001 } : r) }), /500 USD/)
  claims.configureClaims({ totalHunch: '118000000', rewards })
  const poolConfig = JSON.parse(readFileSync(join(directory, 'airdrop-claim-allocations.json'), 'utf8'))
  assert.equal(poolConfig.rewards.reduce((sum: number, r: { amountHunch: string }) => sum + Number(r.amountHunch), 0), 118000000)
  assert.equal(claims.claimAllocation(accounts[24].address)?.amountHunch, '1180000')
  claims.configureClaims({ priceUsd: '0.01', rewards })
  assert.equal(claims.claimAllocation(accounts[0].address)?.amountHunch, '26000')
  assert.equal(claims.claimAllocation(accounts[24].address)?.amountHunch, '500')
  assert.equal(claims.checkClaimPair({ wallet: accounts[0].address, handle: '@BACKER0' }).matches, true)
  assert.throws(() => claims.checkClaimPair({ wallet: accounts[0].address, handle: 'backer1' }), /do not match/)
  assert.throws(() => claims.checkClaimPair({ wallet: privateKeyToAccount(generatePrivateKey()).address, handle: 'backer0' }), /not eligible/)
  assert.ok(!JSON.stringify(claims.claimAllocation(accounts[0].address)).includes('backer0'))
  Object.assign(publicClient, { readContract: async () => 0n, getBalance: async () => 0n })
  await assert.rejects(claims.setClaimsEnabled(true), /Fund/)
  Object.assign(publicClient, { readContract: async () => 50000n * 10n ** 18n, getBalance: async () => 10n ** 16n })
  await claims.setClaimsEnabled(true)
  assert.throws(() => claims.claimChallenge({ wallet: accounts[0].address, handle: 'backer1', follows: true }), /do not match/)
  assert.throws(() => claims.claimChallenge({ wallet: accounts[0].address, handle: 'backer0', follows: false }), /Follow/)
  const challenge = claims.claimChallenge({ wallet: accounts[0].address, handle: '@BACKER0', follows: true })
  const wrong = await accounts[1].signMessage({ message: challenge.message })
  await assert.rejects(claims.executeClaim({ id: challenge.id, signature: wrong }), /does not match/)
  Object.assign(publicClient, { readContract: async () => 0n })
  const signature = await accounts[0].signMessage({ message: challenge.message })
  await assert.rejects(claims.executeClaim({ id: challenge.id, signature }), /funding/)
  const config = JSON.parse(readFileSync(join(directory, 'airdrop-claim-allocations.json'), 'utf8'))
  assert.ok(config.rewards.every((r: { txHash?: string }) => !r.txHash))
  assert.throws(() => claims.configureClaims({ priceUsd: '0.02', rewards }), /Close claims/)
  // Model a request that was durably signed before a restart/response loss.
  const rawTx = '0xdeadbeef' as const
  config.rewards[0].rawTx = rawTx
  config.rewards[0].txHash = keccak256(rawTx)
  writeFileSync(join(directory, 'airdrop-claim-allocations.json'), JSON.stringify(config))
  Object.assign(publicClient, { getTransactionReceipt: async () => { throw new Error('Not found') } })
  const pending = await claims.executeClaim({ id: challenge.id, signature })
  assert.equal(pending.status, 'processing')
  const next = claims.claimChallenge({ wallet: accounts[1].address, handle: 'backer1', follows: true })
  await assert.rejects(claims.executeClaim({ id: next.id, signature: await accounts[1].signMessage({ message: next.message }) }), /awaiting confirmation/)
  const topics = [keccak256(new TextEncoder().encode('Transfer(address,address,uint256)')), encodeAbiParameters([{ type: 'address' }], [treasury.address]), encodeAbiParameters([{ type: 'address' }], [accounts[0].address])]
  Object.assign(publicClient, { getBlockNumber: async () => 104n, getTransactionReceipt: async () => ({ blockNumber: 100n, status: 'success', logs: [{ address: '0x0976f3067dd97321b7ab269c5a2c290264f7046d', topics, data: encodeAbiParameters([{ type: 'uint256' }], [26000n * 10n ** 18n]) }] }) })
  await claims.refreshClaimSettlements()
  assert.equal(claims.claimAllocation(accounts[0].address)?.status, 'processing', 'Five confirmations cannot unlock a claim card')
  assert.equal(claims.claimAllocation(accounts[0].address)?.claimTx, null)
  assert.equal(claims.claimAllocation(accounts[0].address)?.transactionHash, keccak256(rawTx))
  Object.assign(publicClient, { getBlockNumber: async () => 105n })
  // A status check alone must recover the completed transfer; the original claimant need not sign again.
  await claims.refreshClaimSettlements()
  assert.deepEqual(broadcasts, [rawTx], 'Receipt recovery must never broadcast another payment')
  assert.equal(claims.claimAllocation(accounts[0].address)?.status, 'claimed')
  await assert.rejects(claims.executeClaim({ id: challenge.id, signature }), /already claimed/)
  assert.throws(() => claims.claimChallenge({ wallet: accounts[0].address, handle: 'backer0', follows: true }), /already/)
  // Exercise preparation, persistence and broadcast of a new payment on the local RPC.
  Object.assign(publicClient, { readContract: async () => 50000n * 10n ** 18n, getTransactionReceipt: async () => { throw new Error('Not found') }, simulateContract: async () => ({ request: { address: '0x0976f3067dd97321b7ab269c5a2c290264f7046d' }, result: true }) })
  const fresh = claims.claimChallenge({ wallet: accounts[2].address, handle: 'backer2', follows: true })
  const freshSignature = await accounts[2].signMessage({ message: fresh.message })
  assert.equal((await claims.executeClaim({ id: fresh.id, signature: freshSignature })).status, 'processing')
  const persisted = JSON.parse(readFileSync(join(directory, 'airdrop-claim-allocations.json'), 'utf8')).rewards[2]
  const signed = parseTransaction(persisted.rawTx)
  assert.equal(signed.chainId, 4663)
  assert.equal(signed.to?.toLowerCase(), '0x0976f3067dd97321b7ab269c5a2c290264f7046d')
  const transfer = decodeFunctionData({ abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']), data: signed.data! })
  assert.equal(transfer.args[0].toLowerCase(), accounts[2].address.toLowerCase())
  assert.equal(transfer.args[1], 1000n * 10n ** 18n)
  assert.equal(persisted.txHash, keccak256(persisted.rawTx))
  await claims.executeClaim({ id: fresh.id, signature: freshSignature })
  assert.deepEqual(broadcasts.slice(1), [persisted.rawTx, persisted.rawTx], 'A retry must reuse the durably signed transaction')
  await claims.setClaimsEnabled(false)
  await assert.rejects(claims.executeClaim({ id: next.id, signature: await accounts[1].signMessage({ message: next.message }) }), /not open/)
  // An exact-amount mismatch stays unclaimed and cannot silently unblock the treasury.
  // Confirmation recovery remains available after an operator closes new claims.
  const freshTopics = [topics[0], topics[1], encodeAbiParameters([{ type: 'address' }], [accounts[2].address])]
  Object.assign(publicClient, { getTransactionReceipt: async () => ({ blockNumber: 100n, status: 'success', logs: [{ address: signed.to, topics: freshTopics, data: encodeAbiParameters([{ type: 'uint256' }], [1000n * 10n ** 18n]) }] }) })
  await claims.refreshClaimSettlements()
  assert.equal(claims.claimAllocation(accounts[2].address)?.status, 'claimed')
  assert.equal(claims.claimCampaignStatus().claimsOpen, false)
  const mismatch = JSON.parse(readFileSync(join(directory, 'airdrop-claim-allocations.json'), 'utf8'))
  mismatch.rewards[1].rawTx = '0xcafe'
  mismatch.rewards[1].txHash = keccak256('0xcafe')
  writeFileSync(join(directory, 'airdrop-claim-allocations.json'), JSON.stringify(mismatch))
  await claims.refreshClaimSettlements()
  assert.equal(claims.claimAllocation(accounts[1].address)?.status, 'processing')
  assert.match(claims.claimAllocation(accounts[1].address)?.message ?? '', /exact reward/)
  console.log('Claim checks passed: durable exact-transaction retry, read-only confirmation recovery, six-confirmation gate, matching token event/amount, pending serialization, wallet/handle/signature checks and replay rejection. Only a local mock RPC was used.')
} finally { rpc.closeAllConnections(); rpc.close(); rmSync(directory, { recursive: true, force: true }) }
