import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { encodeAbiParameters, keccak256 } from 'viem'
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
    response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: payload.method === 'eth_sendRawTransaction' ? keccak256(payload.params[0]) : '0x1237' }))
  })
})
await new Promise<void>(resolve => rpc.listen(0, '127.0.0.1', resolve))
const rpcAddress = rpc.address() as { port: number }
process.env.ROBINHOOD_RPC_URLS = `http://127.0.0.1:${rpcAddress.port}`
const accounts = Array.from({ length: 26 }, () => privateKeyToAccount(generatePrivateKey()))
const entries = accounts.map((account, i) => ({ id: String(i), wallet: account.address.toLowerCase(), handle: i === 24 ? 'bywrny' : i === 25 ? '7teen_wtf' : `backer${i}`, status: i > 23 ? 'rejected' : 'pending', posts: i > 23 ? [] : [{ id: String(i), url: '', publishedAt: '' }], verificationCode: '', submittedAt: '' }))
writeFileSync(join(directory, 'airdrop-supporters.json'), JSON.stringify(entries))
const claims = await import('../core/airdrop-claims.js')
const { publicClient } = await import('../chain/refuel.js')
const rewards = entries.map((entry, i) => ({ handle: entry.handle, usdCents: i === 0 ? 26000 : i > 23 ? 500 : 1000 }))
try {
  const treasury = claims.initializeClaimTreasury()
  assert.equal(claims.initializeClaimTreasury().address, treasury.address)
  assert.ok(!JSON.stringify(treasury).includes('privateKey'))
  assert.equal(claims.claimCampaignStatus().claimsOpen, false)
  assert.throws(() => claims.configureClaims({ priceUsd: '0', rewards }), /positive/)
  assert.throws(() => claims.configureClaims({ priceUsd: '0.01', rewards: rewards.map((r, i) => i === 25 ? rewards[24] : r) }), /unique/)
  assert.throws(() => claims.configureClaims({ priceUsd: '0.01', rewards: rewards.map((r, i) => i === 0 ? { ...r, usdCents: 26001 } : r) }), /500 USD/)
  claims.configureClaims({ priceUsd: '0.01', rewards })
  assert.equal(claims.claimAllocation(accounts[0].address)?.amountHunch, '26000')
  assert.equal(claims.claimAllocation(accounts[24].address)?.amountHunch, '500')
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
  Object.assign(publicClient, { waitForTransactionReceipt: async () => { throw new Error('Timed out') } })
  const pending = await claims.executeClaim({ id: challenge.id, signature })
  assert.equal(pending.status, 'processing')
  const next = claims.claimChallenge({ wallet: accounts[1].address, handle: 'backer1', follows: true })
  await assert.rejects(claims.executeClaim({ id: next.id, signature: await accounts[1].signMessage({ message: next.message }) }), /awaiting confirmation/)
  const topics = [keccak256(new TextEncoder().encode('Transfer(address,address,uint256)')), encodeAbiParameters([{ type: 'address' }], [treasury.address]), encodeAbiParameters([{ type: 'address' }], [accounts[0].address])]
  Object.assign(publicClient, { waitForTransactionReceipt: async () => ({ status: 'success', logs: [{ address: '0x0976f3067dd97321b7ab269c5a2c290264f7046d', topics, data: encodeAbiParameters([{ type: 'uint256' }], [26000n * 10n ** 18n]) }] }) })
  assert.equal((await claims.executeClaim({ id: challenge.id, signature })).status, 'claimed')
  assert.deepEqual(broadcasts, [rawTx, rawTx])
  assert.equal(claims.claimAllocation(accounts[0].address)?.status, 'claimed')
  await assert.rejects(claims.executeClaim({ id: challenge.id, signature }), /expired/)
  assert.throws(() => claims.claimChallenge({ wallet: accounts[0].address, handle: 'backer0', follows: true }), /already/)
  await claims.setClaimsEnabled(false)
  await assert.rejects(claims.executeClaim({ id: next.id, signature: await accounts[1].signMessage({ message: next.message }) }), /not open/)
  console.log('Claim checks passed: durable treasury, ledger totals/conversion, wallet/handle/follow/signature checks, funding gates, crash-safe exact-transaction retries, pending-transfer serialization, confirmed events and replay rejection. Only a local mock RPC was used.')
} finally { rpc.closeAllConnections(); rpc.close(); rmSync(directory, { recursive: true, force: true }) }
