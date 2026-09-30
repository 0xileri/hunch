// Going to look for a watched entity, rather than waiting for it to turn up.
//
// The four public feeds are a narrow window. A project small enough to need watching is rarely in
// Cointelegraph, so a paid watch could sit for a month and see nothing — the agent would be pointed
// at the wrong haystack. Orbio meters web and social search in CREDIT, so the agent can search for
// each watch's own terms on its own key.
//
// Unlike reading feeds, this costs money, so it is bounded twice: a cap per watch per round, and a
// floor under the watch's remaining budget so that looking never eats the budget for proof.
import { createHash } from 'node:crypto'
import { SEARCH } from '../config.js'
import { log } from '../core/log.js'
import { budgetOf, chargeWatch } from '../core/watches.js'
import type { SourceItem, Watch } from '../core/types.js'
import { callTool } from '../orbio/keys.js'

type Raw = Omit<SourceItem, 'embedding'>

interface SearchHit {
  url?: string
  title?: string
  description?: string
  text?: string
  content?: string
  published?: string
  date?: string
}

/** Orbio returns its cost per call; nothing here guesses at prices. */
interface ToolResult<T> {
  cost?: string
  result?: T
}

const when = (hit: SearchHit) => {
  const raw = hit.published ?? hit.date
  const at = raw ? Date.parse(raw) : NaN
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)

function toItem(hit: SearchHit, watch: Watch, kind: 'search' | 'social', sourceName: string): Raw | null {
  const url = clean(hit.url)
  const title = clean(hit.title)
  const text = clean(hit.text ?? hit.content ?? hit.description)
  if (!text && !title) return null
  return {
    id: createHash('sha256').update(`${watch.id}|${url || title}|${text.slice(0, 120)}`).digest('hex').slice(0, 16),
    sourceId: `${kind}:${watch.id}`,
    sourceName,
    sourceType: kind,
    url,
    title,
    text: text || title,
    links: url ? [url] : [],
    publishedAt: when(hit),
    fetchedAt: new Date().toISOString(),
    demo: false,
  }
}

/** When each watch was last searched for, so a scan every few minutes doesn't search every time. */
const lastRun = new Map<string, number>()

export interface SearchReport {
  watchId: string
  entity: string
  items: number
  costUsd: number
  queries: string[]
  skipped: string | null
}

/**
 * Searches for one watch's terms and returns what it found, already charged to that watch.
 * Returns nothing rather than throwing: a failed search must never stop a scan.
 */
export async function searchForWatch(watch: Watch, now = Date.now()): Promise<{ items: Raw[]; report: SearchReport }> {
  const report: SearchReport = { watchId: watch.id, entity: watch.entity, items: 0, costUsd: 0, queries: [], skipped: null }
  const budget = budgetOf(watch)

  if (!SEARCH.enabled) return { items: [], report: { ...report, skipped: 'searching is off' } }
  if (watch.house) return { items: [], report: { ...report, skipped: 'the house watch reads feeds only' } }
  if (budget.remaining < SEARCH.minRemainingUsd) {
    return { items: [], report: { ...report, skipped: `only ${budget.remaining.toFixed(4)} left, which is kept for proof` } }
  }
  // Looking has its own allowance, so a watch cannot spend its proof budget on search.
  const allowance = watch.fundedUsd * SEARCH.shareOfBudget
  const searched = watch.searchedUsd ?? 0
  if (searched >= allowance) {
    return { items: [], report: { ...report, skipped: `spent its $${allowance.toFixed(3)} search allowance` } }
  }

  const since = now - (lastRun.get(watch.id) ?? 0)
  if (since < SEARCH.everyMin * 60_000) {
    return { items: [], report: { ...report, skipped: `searched ${Math.round(since / 60_000)} min ago` } }
  }
  lastRun.set(watch.id, now)

  // The entity's own name first, then its most distinctive term.
  const queries = [watch.entity, ...watch.terms.filter((t) => t.toLowerCase() !== watch.entity.toLowerCase())].slice(0, SEARCH.maxTerms)
  const items: Raw[] = []
  let costUsd = 0

  for (const query of queries) {
    if (costUsd >= Math.min(SEARCH.maxCostPerRoundUsd, allowance - searched)) break
    report.queries.push(query)
    try {
      const answer = await callTool<ToolResult<{ web?: SearchHit[] }>>('web_search', {
        query,
        limit: SEARCH.limit,
        max_cost: (SEARCH.maxCostPerRoundUsd - costUsd).toFixed(6),
      })
      costUsd += Number(answer.cost ?? 0)
      for (const hit of answer.result?.web ?? []) {
        const item = toItem(hit, watch, 'search', 'web search')
        if (item) items.push(item)
      }
    } catch (err) {
      log('ERROR', `search for ${watch.entity} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // CREDIT spent looking belongs to the watch that asked for it, exactly like inference does.
  const rounded = Math.round(costUsd * 1e6) / 1e6
  if (rounded > 0) {
    chargeWatch(watch.id, rounded)
    watch.searchedUsd = Math.round(((watch.searchedUsd ?? 0) + rounded) * 1e6) / 1e6
  }
  report.items = items.length
  report.costUsd = rounded
  return { items, report }
}

/** Searches for every watch that is due one, newest payers first. */
export async function searchForWatches(watches: Watch[]): Promise<{ items: Raw[]; reports: SearchReport[] }> {
  const items: Raw[] = []
  const reports: SearchReport[] = []
  for (const watch of watches) {
    const found = await searchForWatch(watch)
    items.push(...found.items)
    reports.push(found.report)
    if (found.report.costUsd > 0 || found.report.items) {
      log(
        'WATCHER',
        `searched for ${watch.entity}: ${found.report.items} result${found.report.items === 1 ? '' : 's'} ` +
          `for ${found.report.queries.map((q) => `"${q}"`).join(', ')} · $${found.report.costUsd.toFixed(4)} from its own budget`,
      )
    }
  }
  return { items, reports }
}
