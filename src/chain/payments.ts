// Reading payments off the chain: the agent's side of contracts/HunchPay.sol.
//
// Customers fund a watch by calling `fund(watchId, token, amount)`, which moves the token to the
// treasury and emits `Funded`. The agent polls for those events, credits the matching watch, and
// starts work. Nothing is trusted from the request that created the watch — a watch only becomes
// active when its payment is on chain.
import { encodeFunctionData, formatUnits, parseAbi, type Hex, type Log } from 'viem'
import { LAUNCHPAD, WATCH } from '../config.js'
import { log } from '../core/log.js'
import { save, state } from '../core/state.js'
import { budgetOf, watchById, watches } from '../core/watches.js'
import type { Watch, WatchPayment } from '../core/types.js'
import { CONTRACTS, publicClient, txUrl } from './refuel.js'
import { hunchMarket, priceInToken } from './rate.js'

export const PAY_ABI = parseAbi([
  'event Funded(bytes32 indexed watchId, address indexed payer, address indexed token, uint256 amount)',
  'function fund(bytes32 watchId, address token, uint256 amount)',
  'function accepted(address token) view returns (bool)',
  'function treasury() view returns (address)',
])

export interface PaymentToken {
  symbol: string
  decimals: number
  /** Investigation budget one whole token buys. */
  usdPerUnit: number
}

/**
 * Tokens the agent will credit, and what it prices them at. USDG is a dollar. The agent's own
 * token counts only once someone posts a rate for it: an unpriced token is logged and left
 * uncredited rather than guessed at.
 */
export function paymentTokens(): Record<string, PaymentToken> {
  const tokens: Record<string, PaymentToken> = {
    [CONTRACTS.usdg.toLowerCase()]: { symbol: 'USDG', decimals: 6, usdPerUnit: WATCH.usdPerUsdg },
  }
  if (LAUNCHPAD.token && (WATCH.usdPerHunch > 0 || hunchMarket())) {
    const market = hunchMarket()
    tokens[LAUNCHPAD.token.toLowerCase()] = {
      symbol: LAUNCHPAD.symbol,
      decimals: 18,
      usdPerUnit: (market?.usdPerHunch ?? WATCH.usdPerHunch) * WATCH.hunchBonus,
    }
  }
  return tokens
}

/** A watch id as the contract sees it: the id string, right-padded into a bytes32. */
export function watchIdToBytes32(id: string): Hex {
  const hex = Buffer.from(id, 'utf8').toString('hex')
  if (hex.length > 64) throw new Error(`watch id too long for bytes32: ${id}`)
  return `0x${hex.padEnd(64, '0')}` as Hex
}

export function bytes32ToWatchId(value: string): string {
  const hex = value.replace(/^0x/, '').replace(/(00)+$/, '')
  return Buffer.from(hex, 'hex').toString('utf8')
}

export const payContract = () => (WATCH.contract ? (WATCH.contract as Hex) : null)

/** How far back to look on a cold start, so a restart cannot miss a recent payment. */
const LOOKBACK_BLOCKS = 200_000n

type FundedLog = Log<bigint, number, false, undefined, true, typeof PAY_ABI, 'Funded'>

/**
 * Polls `Funded` events and credits watches. Returns the payments it applied.
 * Idempotent: a payment already recorded on its watch is skipped, so replays are harmless.
 */
export async function collectPayments(): Promise<WatchPayment[]> {
  const address = payContract()
  if (!address || !WATCH.enabled) return []

  const head = await publicClient.getBlockNumber()
  const seen = state.agent.paymentsBlock ? BigInt(state.agent.paymentsBlock) : null
  const from = seen && seen > 0n ? seen + 1n : head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n
  if (from > head) return []

  const logs = (await publicClient.getLogs({
    address,
    event: PAY_ABI[0],
    fromBlock: from,
    toBlock: head,
  })) as FundedLog[]

  const applied: WatchPayment[] = []
  for (const entry of logs) {
    const credited = await creditFromLog(entry)
    if (credited) applied.push(credited)
  }
  state.agent.paymentsBlock = head.toString()
  if (applied.length) save()
  return applied
}

let inflight: Promise<WatchPayment[]> | null = null
let lastRun = 0

/**
 * A payment check someone is waiting on: when a customer opens their watch page, look now rather
 * than at the next scan. Callers share one run, and runs are spaced out, so a page that polls (or
 * a hundred of them) still costs one read of the chain.
 */
export function refreshPayments(maxAgeMs = 8_000): Promise<WatchPayment[]> {
  if (inflight) return inflight
  if (Date.now() - lastRun < maxAgeMs) return Promise.resolve([])
  inflight = collectPayments().finally(() => {
    inflight = null
    lastRun = Date.now()
  })
  return inflight
}

async function creditFromLog(entry: FundedLog): Promise<WatchPayment | null> {
  const { watchId, payer, token, amount } = entry.args
  if (!watchId || !payer || !token || amount === undefined) return null

  const id = bytes32ToWatchId(watchId)
  const watch = watchById(id)
  const txHash = entry.transactionHash ?? ''
  const logIndex = entry.logIndex ?? 0

  if (!watch) {
    log('PAY', `payment for unknown watch ${id || '(unreadable)'} · ${txUrl(txHash)}`)
    return null
  }
  if (watch.payments.some((p) => p.txHash === txHash && p.logIndex === logIndex)) return null

  const known = paymentTokens()[token.toLowerCase()]
  if (!known) {
    log('PAY', `payment to ${watch.id} in an unpriced token ${token} · ${txUrl(txHash)}`)
    return null
  }

  const units = Number(formatUnits(amount, known.decimals))
  const isOwnToken = known.symbol === LAUNCHPAD.symbol
  const priced = isOwnToken ? priceInToken(known.symbol, units) : { usd: units * known.usdPerUnit, from: 'posted' as const }
  const creditedUsd = Math.round(Math.min(priced.usd, WATCH.maxCreditPerPaymentUsd) * 1e6) / 1e6
  if (isOwnToken) {
    const market = hunchMarket()
    log(
      'PAY',
      `${watch.id}: ${units} ${known.symbol} priced ${priced.from === 'market' ? `at market ($${market?.usdPerHunch.toExponential(3)} each, ${market?.trades} trades)` : 'at the posted rate'} ` +
        `plus the ${Math.round((WATCH.hunchBonus - 1) * 100)}% bonus → $${priced.usd.toFixed(2)}`,
    )
  }
  if (priced.usd > creditedUsd) {
    log('PAY', `${watch.id}: ${units} ${known.symbol} is worth $${priced.usd.toFixed(2)}, credited at the $${WATCH.maxCreditPerPaymentUsd} per-payment cap`)
  }
  const payment: WatchPayment = {
    at: new Date().toISOString(),
    txHash,
    logIndex,
    blockNumber: Number(entry.blockNumber ?? 0n),
    from: payer.toLowerCase(),
    token: token.toLowerCase(),
    tokenSymbol: known.symbol,
    amount: units,
    creditedUsd,
  }
  applyPayment(watch, payment)
  return payment
}

/** Credits a payment to its watch and opens or extends the watch. */
export function applyPayment(watch: Watch, payment: WatchPayment): void {
  watch.payments.push(payment)
  watch.fundedUsd = Math.round((watch.fundedUsd + payment.creditedUsd) * 1e6) / 1e6
  watch.owner ??= payment.from

  const now = Date.now()
  const from = watch.expiresAt && Date.parse(watch.expiresAt) > now ? Date.parse(watch.expiresAt) : now
  watch.expiresAt = new Date(from + WATCH.days * 86_400_000).toISOString()
  if (watch.status === 'pending' || watch.status === 'expired') {
    watch.status = 'active'
    watch.activatedAt ??= new Date().toISOString()
  }
  log(
    'PAY',
    `${watch.id} funded: ${payment.amount} ${payment.tokenSymbol} → $${payment.creditedUsd.toFixed(2)} of investigation budget ` +
      `(${budgetOf(watch).remaining.toFixed(2)} available, watching ${watch.entity} until ${watch.expiresAt.slice(0, 10)}) · ${txUrl(payment.txHash)}`,
  )
}

const ERC20_APPROVE = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])

/** What a customer needs in order to pay: where to send it, in what, and tagged with which id. */
export function paymentInstructions(watch: Watch) {
  const address = payContract()
  const minUnits = BigInt(Math.round(WATCH.minUsdg * 1e6))
  // Ready-made calls for the minimum, so a wallet or explorer can execute them without guesswork.
  const calls = address
    ? {
        approve: encodeFunctionData({ abi: ERC20_APPROVE, functionName: 'approve', args: [address, minUnits] }),
        fund: encodeFunctionData({
          abi: PAY_ABI,
          functionName: 'fund',
          args: [watchIdToBytes32(watch.id), CONTRACTS.usdg as Hex, minUnits],
        }),
      }
    : null
  return {
    calls,
    ready: Boolean(address),
    contract: address,
    chainId: 4663,
    token: CONTRACTS.usdg,
    tokenSymbol: 'USDG',
    decimals: 6,
    minAmount: WATCH.minUsdg,
    usdPerUnit: WATCH.usdPerUsdg,
    alsoAccepts: Object.entries(paymentTokens())
      .filter(([addr]) => addr !== CONTRACTS.usdg.toLowerCase())
      .map(([addr, t]) => ({ token: addr, symbol: t.symbol, usdPerUnit: t.usdPerUnit, decimals: t.decimals })),
    watchIdBytes32: watchIdToBytes32(watch.id),
    steps: address
      ? [
          `approve ${address} to spend USDG on ${CONTRACTS.usdg}`,
          `call fund(${watchIdToBytes32(watch.id)}, ${CONTRACTS.usdg}, amount) on ${address}`,
        ]
      : ['the payment contract is not deployed yet'],
  }
}

export const openWatchesFor = (owner: string) =>
  watches().filter((w) => !w.house && w.owner === owner.toLowerCase() && (w.status === 'pending' || w.status === 'active')).length
