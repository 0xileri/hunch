import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const directory = mkdtempSync(join(tmpdir(), 'hunch-airdrop-'))
process.env.DATA_DIR = directory
const { AIRDROP, eligiblePost, createAirdropChallenge, submitAirdrop, airdropStatus, reviewAirdrop, confirmAirdropPayout, excludeAirdropPosts, airdropReviewEntries } = await import('../core/airdrop.js')
const post = (date: string, handle = 'earlybacker') => `https://x.com/${handle}/status/${(BigInt(Date.parse(date)) - 1288834974657n) << 22n}`
const account = privateKeyToAccount(generatePrivateKey())
const other = privateKeyToAccount(generatePrivateKey())
const url = post('2026-09-20T12:00:00Z')
try {
  assert.equal(eligiblePost(url, 'earlybacker').publishedAt, '2026-09-20T12:00:00.000Z')
  assert.throws(() => eligiblePost(post('2026-10-02T10:47:13Z'), 'earlybacker'), /cutoff/)
  assert.throws(() => eligiblePost(post('2026-09-17T12:00:00Z'), 'earlybacker'), /cutoff/)
  assert.throws(() => eligiblePost(url, 'someoneelse'), /belong/)
  assert.throws(() => eligiblePost(url.replace('x.com', 'x.com.attacker.example'), 'earlybacker'), /X post link/)
  const body = { wallet: account.address, handle: '@EarlyBacker', posts: [{ url }] }
  assert.throws(() => createAirdropChallenge({ ...body, posts: [{ url }, { url }] }), /duplicate/)
  const challenge = createAirdropChallenge(body)
  const wrong = await other.signMessage({ message: challenge.message })
  await assert.rejects(submitAirdrop({ id: challenge.id, signature: wrong }), /does not match/)
  const signature = await account.signMessage({ message: challenge.message })
  const result = await submitAirdrop({ id: challenge.id, signature })
  assert.match(result.verificationCode, /^HUNCH-[A-F0-9]{12}$/)
  assert.equal(result.status, 'pending')
  await assert.rejects(submitAirdrop({ id: challenge.id, signature }), /expired/)
  assert.throws(() => createAirdropChallenge(body), /already/)
  const status = airdropStatus(account.address)
  assert.equal(status.submission?.status, 'pending')
  assert.equal(status.allocation, null)
  assert.equal(AIRDROP.claimsOpen, false)
  assert.ok(!JSON.stringify(status).includes('earlybacker'))
  assert.equal(airdropStatus(other.address).submission, null)
  assert.throws(() => reviewAirdrop(result.id, { status: 'approved', amountHunch: '0' }), /positive/)
  assert.throws(() => reviewAirdrop(result.id, { status: 'claimed', amountHunch: '1000' }), /approved or rejected/)
  reviewAirdrop(result.id, { status: 'approved', amountHunch: '1250.5' })
  assert.equal(airdropStatus(account.address).allocation?.amountHunch, '1250.5')
  assert.equal(airdropStatus(account.address).allocation?.claimTx, null)
  await assert.rejects(confirmAirdropPayout(result.id, 'invalid'), /transaction hash/)
  reviewAirdrop(result.id, { status: 'rejected' })
  assert.equal(airdropStatus(account.address).allocation, null)
  await assert.rejects(confirmAirdropPayout(result.id, '0x' + '0'.repeat(64)), /Approve/)
  assert.throws(() => excludeAirdropPosts(result.id, { postIds: ['unknown'], reason: 'Reply' }), /existing/)
  const excluded = excludeAirdropPosts(result.id, { postIds: [eligiblePost(url, 'earlybacker').id], reason: 'Reply posts are excluded from the supporter campaign.' })
  assert.equal(excluded.remainingPosts, 0)
  assert.equal(excluded.status, 'rejected')
  assert.equal(airdropReviewEntries()[0].posts.length, 0)
  assert.equal(airdropReviewEntries()[0].excludedPosts.length, 1)
  console.log('Airdrop checks passed: cutoff, authorship, URL validation, duplicates, wallet signature, replay prevention, private status and closed claims.')
} finally { rmSync(directory, { recursive: true, force: true }) }
