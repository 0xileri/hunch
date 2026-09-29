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
import { publicClient } from './refuel.js'

const TRANSFER = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0]
const ORBIO = '0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3'

export interface HunchMarket {
  /** HUNCH per ORBIO, the median of recent trades. */
  hunchPerOrbio: number
  /** ORBIO's dollar price, as posted by the operator. */
  orbioUsd: number
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

  const hunchPerOrbio = median(ratios)
  const usdPerHunch = LAUNCHPAD.orbioUsd / hunchPerOrbio
  const postedUsdPerHunch = WATCH.usdPerHunch * WATCH.hunchBonus
  const drift = usdPerHunch > 0 ? postedUsdPerHunch / usdPerHunch : 0
  return {
    hunchPerOrbio,
    orbioUsd: LAUNCHPAD.orbioUsd,
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
