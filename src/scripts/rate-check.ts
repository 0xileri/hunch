// Prices HUNCH from recent trades and compares it with the rate the agent posts for watch
// payments. Read-only: no key, no spend, no transaction.
import '../env.js'
import { LAUNCHPAD, WATCH } from '../config.js'
import { readHunchMarket } from '../chain/rate.js'

const m = await readHunchMarket()
if (!m) {
  console.log('No trades found in the window, so there is nothing to price against.')
  console.log(`token ${LAUNCHPAD.token ?? '(unset)'} · pool ${LAUNCHPAD.pool ?? '(unset)'}`)
  process.exit(0)
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`
console.log(`trades sampled   ${m.trades}`)
console.log(`HUNCH per ORBIO  ${m.hunchPerOrbio.toFixed(0)}`)
console.log(`ORBIO posted     $${m.orbioUsd}`)
console.log(`market per HUNCH $${m.usdPerHunch.toExponential(3)}`)
console.log(`posted per HUNCH $${m.postedUsdPerHunch.toExponential(3)} (rate $${WATCH.usdPerHunch} × ${WATCH.hunchBonus} bonus)`)
console.log(`drift            ${m.drift.toFixed(3)} · limit ${WATCH.rateDriftMax}`)
console.log(
  m.stale ?
    `\nThe posted rate is ${pct(m.drift - 1)} above market, so payments in HUNCH are credited at market value instead.\nUpdate WATCH_USD_PER_HUNCH to about ${(m.usdPerHunch / WATCH.hunchBonus).toExponential(2)} to post market again.`
  : `\nThe posted rate stands: it credits ${pct(m.drift)} of market value.`,
)
