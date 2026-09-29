// What HUNCH is actually worth, read off the chain.
//
// The agent accepts its own token for watches at a rate someone posted by hand. A posted rate goes
// stale, and a stale rate is a cheap way to buy investigation budget, so the agent checks itself:
// it prices recent trades in the HUNCH/ORBIO pool, converts with ORBIO's dollar price, and compares.
//
// Nothing here refuses a payment. The credit is clamped to what the tokens are worth, so an
// out-of-date rate costs the house nothing and never leaves a payer with nothing.
import { parseAbi, formatUnits, type Hex } from 'viem'
import { LAUNCHPAD, WATCH } from '../config.js'
import { log } from '../core/log.js'
import { CONTRACTS, publicClient } from './refuel.js'

const TRANSFER = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0]
const ORBIO = '0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3'

export interface HunchMarket {
  /** HUNCH per ORBIO, the median of recent trades. */
  hunchPerOrbio: number
  /** ORBIO's dollar price. */
  orbioUsd: number
  /** Where that price came from: trades on chain, or the operator's posted fallback. */
  orbioUsdFrom: 'chain' | 'posted'
  orbioSamples: number
  /** What one HUNCH is worth, from those two. */
  usdPerHunch: number
  /** What the posted rate credits per HUNCH, bonus included. */
  postedUsdPerHunch: number
  /** posted ÷ market. Above 1 the agent is generous; below 1 nobody will pay in HUNCH. */
  drift: number
  /** True when the posted rate is generous enough that credits get clamped to market. */
  stale: boolean
  trades: number
  at: string
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** The median, then the median again without anything wildly off it. */
function trimmedMedian(xs: number[], tolerance = 0.5): number {
  const first = median(xs)
  const kept = xs.filter((x) => Math.abs(x - first) / first <= tolerance)
  return kept.length >= 3 ? median(kept) : first
}

const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const USDG = CONTRACTS.usdg.toLowerCase()

export interface OrbioPrice {
  usd: number
  samples: number
  at: string
}

let orbioPrice: OrbioPrice | null = null
export const orbioUsdReading = () => orbioPrice

/**
 * What ORBIO is worth, from trades rather than from a number someone typed.
 *
 * USDG is far too busy to scan for directly — ten thousand transfers in ten minutes — so this goes
 * the other way: ORBIO moves rarely enough to list, and each of those transactions is opened to see
 * what USDG came back. A swap carries both legs; the ratio is the price that trade paid. Routes
 * that hop through other tokens give lopsided pairs, so the median is trimmed before it is used.
 */
export async function readOrbioUsd(windowBlocks = BigInt(LAUNCHPAD.rateWindowBlocks / 25), maxTx = 20): Promise<OrbioPrice | null> {
  const head = await publicClient.getBlockNumber()
  const fromBlock = head > windowBlocks ? head - windowBlocks : 0n
  const logs = await publicClient.getLogs({ address: ORBIO as Hex, event: TRANSFER, fromBlock, toBlock: head })
  const hashes = [...new Set(logs.map((l) => l.transactionHash).filter(Boolean))].slice(-maxTx) as Hex[]

  const rates: number[] = []
  for (const hash of hashes) {
    const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null)
    if (!receipt) continue
    let orbio = 0
    let usdg = 0
    for (const entry of receipt.logs) {
      // Some tokens in the same transaction emit a Transfer with no data at all; skip those.
      if (entry.topics[0] !== TRANSFER_SIG || entry.topics.length < 3 || entry.data.length < 4) continue
      const value = BigInt(entry.data)
      const address = entry.address.toLowerCase()
      if (address === ORBIO) orbio = Math.max(orbio, Number(formatUnits(value, 18)))
      else if (address === USDG) usdg = Math.max(usdg, Number(formatUnits(value, 6)))
    }
    // Dust and one-sided transfers say nothing about price.
    if (orbio >= 1 && usdg >= 0.5) rates.push(usdg / orbio)
  }
  if (rates.length < 3) return orbioPrice

  orbioPrice = { usd: trimmedMedian(rates), samples: rates.length, at: new Date().toISOString() }
  return orbioPrice
}

/**
 * Prices recent swaps. A trade shows up as a HUNCH transfer touching the pool and an ORBIO
 * transfer in the same transaction; the ratio of the two is the price that trade paid.
 */
export async function readHunchMarket(windowBlocks = BigInt(LAUNCHPAD.rateWindowBlocks)): Promise<HunchMarket | null> {
  const token = LAUNCHPAD.token as Hex | null
  const pool = LAUNCHPAD.pool?.toLowerCase()
  if (!token || !pool || !LAUNCHPAD.orbioUsd) return null

  const head = await publicClient.getBlockNumber()
  const fromBlock = head > windowBlocks ? head - windowBlocks : 0n
  const [hunchLogs, orbioLogs] = await Promise.all([
    publicClient.getLogs({ address: token, event: TRANSFER, fromBlock, toBlock: head }),
    publicClient.getLogs({ address: ORBIO as Hex, event: TRANSFER, fromBlock, toBlock: head }),
  ])

  // The biggest ORBIO leg in a transaction is the one paid for the tokens; the rest is fee routing.
  const orbioByTx = new Map<string, number>()
  for (const l of orbioLogs) {
    const value = Number(formatUnits(l.args.value ?? 0n, 18))
    const tx = l.transactionHash ?? ''
    orbioByTx.set(tx, Math.max(orbioByTx.get(tx) ?? 0, value))
  }

  const ratios: number[] = []
  const seen = new Set<string>()
  for (const l of hunchLogs) {
    const tx = l.transactionHash ?? ''
    if (seen.has(tx)) continue
    const from = (l.args.from ?? '').toLowerCase()
    const to = (l.args.to ?? '').toLowerCase()
    if (from !== pool && to !== pool) continue
    const hunch = Number(formatUnits(l.args.value ?? 0n, 18))
    const orbio = orbioByTx.get(tx) ?? 0
    if (!hunch || !orbio) continue
    seen.add(tx)
    ratios.push(hunch / orbio)
  }
  if (!ratios.length) return null

  const hunchPerOrbio = trimmedMedian(ratios)
  // Prefer a price the chain can show over one someone typed months ago.
  const measured = await readOrbioUsd().catch((err) => {
    log('ERROR', `could not price ORBIO on chain, falling back to the posted price: ${err instanceof Error ? err.message : String(err)}`)
    return orbioUsdReading()
  })
  const orbioUsd = measured?.usd ?? LAUNCHPAD.orbioUsd
  const usdPerHunch = orbioUsd / hunchPerOrbio
  const postedUsdPerHunch = WATCH.usdPerHunch * WATCH.hunchBonus
  const drift = usdPerHunch > 0 ? postedUsdPerHunch / usdPerHunch : 0
  return {
    hunchPerOrbio,
    orbioUsd,
    orbioUsdFrom: measured ? 'chain' : 'posted',
    orbioSamples: measured?.samples ?? 0,
    usdPerHunch,
    postedUsdPerHunch,
    drift,
    stale: drift > WATCH.rateDriftMax,
    trades: ratios.length,
    at: new Date().toISOString(),
  }
}

/** The last reading, kept so a payment can be priced without waiting on the chain. */
let last: HunchMarket | null = null
export const hunchMarket = () => last
export const setHunchMarket = (m: HunchMarket | null) => {
  if (m) last = m
}

/**
 * What a payment in this token should credit. The posted rate applies while it is close to the
 * market; past the drift limit the tokens are credited at what they are worth instead.
 */
export function clampToMarket(symbol: string, units: number, postedUsd: number): { usd: number; clamped: boolean } {
  const market = last
  if (!market || symbol !== LAUNCHPAD.symbol || !market.stale) return { usd: postedUsd, clamped: false }
  const worth = units * market.usdPerHunch * WATCH.hunchBonus
  return worth < postedUsd ? { usd: worth, clamped: true } : { usd: postedUsd, clamped: false }
}
