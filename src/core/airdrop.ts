import { randomBytes, randomUUID } from 'node:crypto'
import { decodeEventLog, isAddress, parseAbi, parseUnits, verifyMessage, type Address, type Hex } from 'viem'
import { publicClient, treasuryAccount } from '../chain/refuel.js'
import { readJson, writeJson } from './store.js'
import { PUBLIC_URL } from '../config.js'

// Immutable campaign cutoff. This freezes eligible publication times, not X view counts.
export const AIRDROP = {
  id: 'hunch-supporters-2026-10-02',
  snapshotAt: '2026-10-02T10:47:12.000Z',
  launchAt: '2026-09-18T22:12:26.000Z',
  poolUsd: 500,
  chainId: 4663,
  token: '0x0976f3067dd97321b7ab269c5a2c290264f7046d',
  status: 'review' as const,
  claimsOpen: false,
}
type Post = { url: string; id: string; publishedAt: string; reportedViews: number | null }
type Entry = { id: string; wallet: string; handle: string; posts: Post[]; verificationCode: string; submittedAt: string; status: 'pending' | 'approved' | 'rejected' | 'claimed'; amountHunch?: string; reviewedAt?: string; claimTx?: string }
const entries = readJson<Entry[]>('airdrop-supporters.json', [])
const challenges = new Map<string, { wallet: string; handle: string; posts: Post[]; message: string; expiresAt: number }>()

export class AirdropError extends Error {}
const invalid = (message: string): never => { throw new AirdropError(message) }

export function eligiblePost(url: string, handle: string): Post {
  let parsed: URL
  try { parsed = new URL(url) } catch { return invalid('Use a full X post URL.') }
  const match = parsed.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{15,22})\/?$/)
  if (parsed.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port || !match)
    return invalid('Use an X post link such as https://x.com/handle/status/123…')
  if (match[1].toLowerCase() !== handle) return invalid('Every submitted post must belong to your X handle.')
  const milliseconds = Number((BigInt(match[2]) >> 22n) + 1288834974657n)
  if (!Number.isSafeInteger(milliseconds) || milliseconds < Date.parse(AIRDROP.launchAt) || milliseconds > Date.parse(AIRDROP.snapshotAt))
    return invalid('Only posts published between Hunch’s launch and the snapshot cutoff qualify.')
  return { url: `https://x.com/${handle}/status/${match[2]}`, id: match[2], publishedAt: new Date(milliseconds).toISOString(), reportedViews: null }
}

function parseRequest(body: unknown) {
  if (!body || typeof body !== 'object') return invalid('Send your wallet, X handle and existing post links.')
  const input = body as Record<string, unknown>
  if (typeof input.wallet !== 'string' || !isAddress(input.wallet)) return invalid('Provide a valid wallet address.')
  const wallet = input.wallet.toLowerCase()
  const handle = typeof input.handle === 'string' ? input.handle.trim().replace(/^@/, '').toLowerCase() : ''
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return invalid('Provide a valid X handle.')
  if (!Array.isArray(input.posts) || input.posts.length < 1 || input.posts.length > 20) return invalid('Submit 1–20 existing posts.')
  const posts = input.posts.map((p: unknown) => {
    if (!p || typeof p !== 'object') return invalid('Each post needs an X link.')
    const row = p as Record<string, unknown>
    if (typeof row.url !== 'string' || row.url.length > 300) return invalid('Use a valid X post link.')
    const post = eligiblePost(row.url, handle)
    if (row.reportedViews !== null && row.reportedViews !== undefined && row.reportedViews !== '') {
      if (typeof row.reportedViews !== 'number' || !Number.isSafeInteger(row.reportedViews) || row.reportedViews < 0 || row.reportedViews > 1_000_000_000)
        return invalid('Views must be a whole number between 0 and 1 billion.')
      post.reportedViews = row.reportedViews
    }
    return post
  })
  if (new Set(posts.map(p => p.id)).size !== posts.length) return invalid('Remove duplicate post links.')
  if (entries.some(e => e.wallet === wallet || e.handle === handle)) return invalid('This wallet or X account already has a submission. Keep your confirmation code for review.')
  if (posts.some(p => entries.some(e => e.posts.some(saved => saved.id === p.id)))) return invalid('A submitted post is already registered.')
  return { wallet, handle, posts }
}

export function createAirdropChallenge(body: unknown) {
  const request = parseRequest(body)
  const now = Date.now()
  for (const [id, c] of challenges) if (c.expiresAt < now) challenges.delete(id)
  if (challenges.size >= 1000) return invalid('Submissions are busy. Please try again shortly.')
  const id = randomUUID()
  const expiresAt = now + 10 * 60_000
  const message = [`Hunch supporter airdrop submission`, `Website: ${PUBLIC_URL}`, `Campaign: ${AIRDROP.id}`, `Wallet: ${request.wallet}`, `X account: @${request.handle}`, `Snapshot: ${AIRDROP.snapshotAt}`, ...request.posts.map(p => `Post: ${p.url} | reported views: ${p.reportedViews ?? 'not supplied'}`), `Nonce: ${id}`, `Expires: ${new Date(expiresAt).toISOString()}`, 'This signature registers a review request. It does not transfer tokens or grant spending approval.'].join('\n')
  challenges.set(id, { ...request, message, expiresAt })
  return { id, message, expiresAt: new Date(expiresAt).toISOString() }
}

export async function submitAirdrop(body: unknown) {
  const input = body as { id?: unknown; signature?: unknown } | null
  if (!input || typeof input.id !== 'string' || typeof input.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return invalid('Provide the wallet signature for your submission.')
  const challenge = challenges.get(input.id)
  if (!challenge || challenge.expiresAt < Date.now()) return invalid('Your signature request expired. Start again.')
  const valid = await verifyMessage({ address: challenge.wallet as Address, message: challenge.message, signature: input.signature as Hex }).catch(() => false)
  if (!valid) return invalid('The signature does not match this wallet.')
  // Re-check after asynchronous signature verification to prevent duplicate concurrent requests.
  parseRequest(challenge)
  const entry: Entry = { id: randomUUID(), wallet: challenge.wallet, handle: challenge.handle, posts: challenge.posts, verificationCode: `HUNCH-${randomBytes(6).toString('hex').toUpperCase()}`, submittedAt: new Date().toISOString(), status: 'pending' }
  writeJson('airdrop-supporters.json', [...entries, entry])
  entries.push(entry)
  challenges.delete(input.id)
  return { id: entry.id, status: entry.status, verificationCode: entry.verificationCode }
}

export const airdropStatus = (wallet: string) => {
  if (!isAddress(wallet)) return invalid('Provide a valid wallet address.')
  const entry = entries.find(e => e.wallet === wallet.toLowerCase())
  // Do not expose X identities, links or verification codes through public wallet lookups.
  return { campaign: AIRDROP, submission: entry ? { status: entry.status, submittedAt: entry.submittedAt } : null, allocation: entry?.amountHunch && ['approved', 'claimed'].includes(entry.status) ? { amountHunch: entry.amountHunch, status: entry.status, claimTx: entry.claimTx ?? null } : null, message: 'Allocations are under review. Claims are not open.' }
}
export const airdropReviewEntries = () => entries

export function reviewAirdrop(id: string, body: unknown) {
  const entry = entries.find(e => e.id === id)
  if (!entry) return invalid('Entry not found.')
  if (entry.status === 'claimed') return invalid('A confirmed claim cannot be edited.')
  const input = body as { status?: unknown; amountHunch?: unknown } | null
  if (!input || !['approved', 'rejected'].includes(String(input.status))) return invalid('Choose approved or rejected.')
  let amount: string | undefined
  if (input.status === 'approved') {
    if (typeof input.amountHunch !== 'string' || !/^\d{1,15}(\.\d{1,18})?$/.test(input.amountHunch) || parseUnits(input.amountHunch, 18) <= 0n)
      return invalid('Provide the approved HUNCH amount as a positive decimal string.')
    amount = input.amountHunch
  }
  const updated: Entry = { ...entry, status: input.status as 'approved' | 'rejected', amountHunch: amount, reviewedAt: new Date().toISOString() }
  writeJson('airdrop-supporters.json', entries.map(e => e.id === id ? updated : e))
  Object.assign(entry, updated)
  return { id, status: entry.status }
}

// An operator may record a completed payout, but the chain must prove the treasury transfer.
// There is no public endpoint that can mark a wallet claimed.
export async function confirmAirdropPayout(id: string, hash: unknown) {
  const entry = entries.find(e => e.id === id)
  if (!entry || entry.status !== 'approved' || !entry.amountHunch) return invalid('Approve the allocation before recording a payout.')
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return invalid('Provide a valid transaction hash.')
  if (entries.some(e => e.claimTx?.toLowerCase() === hash.toLowerCase())) return invalid('This payout transaction is already recorded.')
  const treasury = treasuryAccount()
  if (!treasury) return invalid('The campaign treasury is not configured.')
  const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex })
  const latest = await publicClient.getBlockNumber()
  if (receipt.status !== 'success' || latest < receipt.blockNumber + 5n) return invalid('The payout needs a successful receipt and six block confirmations.')
  const abi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])
  let received = 0n
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== AIRDROP.token.toLowerCase()) continue
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics })
      if (event.args.from.toLowerCase() === treasury.address.toLowerCase() && event.args.to.toLowerCase() === entry.wallet) received += event.args.value
    } catch { /* Ignore unrelated events. */ }
  }
  if (received !== parseUnits(entry.amountHunch, 18)) return invalid('The receipt does not show the exact approved HUNCH transfer from the campaign treasury to this wallet.')
  // Re-check after RPC waits; no concurrent approval change or duplicate confirmation may win.
  if (entry.status !== 'approved' || entries.some(e => e.claimTx?.toLowerCase() === hash.toLowerCase())) return invalid('The entry changed during verification. Try again.')
  const updated: Entry = { ...entry, status: 'claimed', claimTx: hash }
  writeJson('airdrop-supporters.json', entries.map(e => e.id === id ? updated : e))
  Object.assign(entry, updated)
  return { id, status: entry.status, claimTx: hash }
}
