// A watch is what Hunch sells: prepaid investigation budget aimed at one entity.
//
// Someone pays USDG through the payment contract, that payment becomes their watch's budget, and
// the agent spends it only when its own policy says a hunch is worth proving. The margin is the
// spread on fuel: the treasury buys CREDIT under par, so a dollar paid in funds a dollar of
// inference and the house keeps the difference.
//
// The house watch is the mission the operator configured (the demo's Project X by default). It
// always exists, it is never paid for, and it spends the operator's own budget.
import { randomBytes } from 'node:crypto'
import { MISSION, POLICY, WATCH } from '../config.js'
import { missionBudgetUsd, missionSpentUsd, save, state } from './state.js'
import type { Watch, WatchBudget } from './types.js'

export const HOUSE_ID = 'wat_house'

export function houseWatch(): Watch {
  const found = state.watches.find((w) => w.id === HOUSE_ID)
  if (found) {
    // The operator can re-point the mission with environment variables between restarts.
    found.entity = MISSION.entity
    found.statement = MISSION.statement
    found.terms = MISSION.terms
    found.officialSources = MISSION.officialSources
    return found
  }
  const house: Watch = {
    id: HOUSE_ID,
    house: true,
    entity: MISSION.entity,
    statement: MISSION.statement,
    terms: MISSION.terms,
    officialSources: MISSION.officialSources,
    owner: null,
    status: 'active',
    createdAt: state.agent.startedAt ?? new Date().toISOString(),
    activatedAt: state.agent.startedAt ?? new Date().toISOString(),
    expiresAt: null,
    fundedUsd: 0,
    spentUsd: 0,
    payments: [],
  }
  state.watches.unshift(house)
  return house
}

/** Every watch, house first. */
export function watches(): Watch[] {
  houseWatch()
  return state.watches
}

export const watchById = (id: string | null | undefined): Watch | null =>
  id ? watches().find((w) => w.id === id) ?? null : null

/** Watches the agent currently works for: funded (or the house), not expired, not cancelled. */
export function activeWatches(now = Date.now()): Watch[] {
  return watches().filter((w) => {
    if (w.status === 'cancelled') return false
    if (w.house) return true
    if (w.expiresAt && Date.parse(w.expiresAt) < now) {
      if (w.status === 'active') w.status = 'expired'
      return false
    }
    return w.status === 'active' && budgetOf(w).remaining > WATCH.dustUsd
  })
}

/**
 * The budget this watch may spend against. The house spends the operator's mission budget (plus
 * confirmed refuels); a paid watch spends exactly what was paid into it, with the same reserve
 * and per-investigation cap applied to its own balance.
 */
export function budgetOf(watch: Watch): WatchBudget {
  const budgetUsd = watch.house ? missionBudgetUsd() : watch.fundedUsd
  const spentUsd = watch.house ? missionSpentUsd() : watch.spentUsd
  const reserve = budgetUsd * POLICY.reserveShare
  const cap = budgetUsd * POLICY.maxPerInvestigationShare
  const remaining = Math.max(0, budgetUsd - spentUsd)
  return {
    budgetUsd,
    spentUsd,
    remaining,
    reserve,
    cap,
    available: Math.max(0, Math.min(cap, remaining - reserve)),
  }
}

/** The watch a cluster is on mission for: the first active watch whose terms appear in its text. */
export function matchWatch(text: string): { watch: Watch; terms: string[] } | null {
  const haystack = text.toLowerCase()
  // Paid watches first: a customer's entity wins over the house's when a post mentions both.
  const candidates = [...activeWatches()].sort((a, b) => Number(a.house) - Number(b.house))
  for (const watch of candidates) {
    const terms = watch.terms.filter((term) => haystack.includes(term))
    if (terms.length) return { watch, terms }
  }
  return null
}

/** Terms too common to identify anything: a watch on these would match half the internet. */
const TOO_BROAD = new Set([
  'the', 'and', 'crypto', 'token', 'coin', 'bitcoin', 'btc', 'eth', 'ethereum', 'defi', 'nft', 'airdrop',
  'wallet', 'exchange', 'hack', 'exploit', 'withdrawal', 'withdrawals', 'price', 'pump', 'dump', 'news',
])

export class WatchError extends Error {}

export interface WatchRequest {
  entity: string
  terms: string[]
  statement?: string
  officialUrls?: string[]
  owner?: string
}

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '')

/**
 * Opens a pending watch. It does nothing until a payment for it lands on chain — see
 * src/chain/payments.ts — so this only has to be cheap to refuse and impossible to abuse.
 */
export function createWatch(req: WatchRequest): Watch {
  if (!WATCH.enabled) throw new WatchError('watches are not open')

  const entity = clean(req.entity)
  if (entity.length < 2 || entity.length > 60) throw new WatchError('the entity needs 2 to 60 characters')

  const terms = [...new Set((req.terms ?? []).map((t) => clean(t).toLowerCase()).filter(Boolean))]
  if (!terms.length) throw new WatchError('give at least one term to watch for')
  if (terms.length > WATCH.maxTerms) throw new WatchError(`at most ${WATCH.maxTerms} terms`)
  for (const term of terms) {
    if (term.length < 3) throw new WatchError(`"${term}" is too short to identify anything`)
    if (term.length > 40) throw new WatchError(`"${term}" is too long`)
    if (TOO_BROAD.has(term)) throw new WatchError(`"${term}" matches far too much to be useful`)
  }

  // Terms are how a claim is routed to a watch, so they may not overlap another live watch's.
  for (const other of activeWatches()) {
    for (const mine of terms) {
      const clash = other.terms.find((t) => t === mine || t.includes(mine) || mine.includes(t))
      if (clash) throw new WatchError(`"${mine}" overlaps a watch that already runs on "${clash}"`)
    }
  }

  const officialSources = (req.officialUrls ?? []).slice(0, 4).map((raw) => {
    let url: URL
    try {
      url = new URL(clean(raw))
    } catch {
      throw new WatchError(`${raw} is not a URL`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WatchError('official pages must be http or https')
    return { name: url.hostname, url: url.toString() }
  })

  const owner = clean(req.owner).toLowerCase()
  if (owner && !/^0x[0-9a-f]{40}$/.test(owner)) throw new WatchError('the owner must be a wallet address')
  if (owner && watches().filter((w) => !w.house && w.owner === owner && (w.status === 'pending' || w.status === 'active')).length >= WATCH.maxPerOwner) {
    throw new WatchError(`that address already holds ${WATCH.maxPerOwner} open watches`)
  }

  prunePending()
  if (state.watches.filter((w) => w.status === 'pending').length >= 200) throw new WatchError('too many unpaid watches are waiting; try later')

  const watch: Watch = {
    id: `wat_${randomBytes(4).toString('hex')}`,
    house: false,
    entity,
    statement: clean(req.statement) || `Protect ${entity} from emerging information risks`,
    terms,
    officialSources,
    owner: owner || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    activatedAt: null,
    expiresAt: null,
    fundedUsd: 0,
    spentUsd: 0,
    payments: [],
  }
  state.watches.push(watch)
  save()
  return watch
}

/** Unpaid watches are just a request; they expire after a day so the list stays honest. */
export function prunePending(now = Date.now()): void {
  state.watches = state.watches.filter(
    (w) => w.house || w.status !== 'pending' || w.payments.length > 0 || Date.parse(w.createdAt) > now - 86_400_000,
  )
}

/** Records inference spend against the watch that asked for it. The house uses the spend ledger. */
export function chargeWatch(watchId: string | null, costUsd: number): void {
  const watch = watchById(watchId)
  if (!watch || watch.house) return
  watch.spentUsd = Math.round((watch.spentUsd + costUsd) * 1e6) / 1e6
  if (budgetOf(watch).remaining <= WATCH.dustUsd) watch.status = 'expired'
}
