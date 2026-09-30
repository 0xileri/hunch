// Tries the search layer against one entity and prints what it found and what it cost.
// Spends a fraction of a cent of real CREDIT, so it takes the entity as an argument.
process.env.DATA_DIR ??= new URL('../../.search-check', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
import '../env.js'
import { SEARCH } from '../config.js'
import { searchForWatch } from '../watcher/search.js'
import type { Watch } from '../core/types.js'

const entity = process.argv[2] ?? '0xperceptor'
const terms = process.argv.slice(3)

const watch: Watch = {
  id: 'wat_check',
  house: false,
  entity,
  statement: `Protect ${entity}`,
  terms: terms.length ? terms : [entity.toLowerCase()],
  officialSources: [],
  owner: null,
  status: 'active',
  createdAt: new Date().toISOString(),
  activatedAt: new Date().toISOString(),
  expiresAt: null,
  fundedUsd: 5,
  spentUsd: 0,
  payments: [],
}

console.log(`searching for "${entity}" (terms: ${watch.terms.join(', ')}) · limit ${SEARCH.limit}, cap $${SEARCH.maxCostPerRoundUsd}\n`)
const { items, report } = await searchForWatch(watch)
console.log(`queries: ${report.queries.map((q) => `"${q}"`).join(', ')}`)
console.log(`cost:    $${report.costUsd.toFixed(6)} · charged to the watch`)
console.log(`found:   ${items.length} item${items.length === 1 ? '' : 's'}${report.skipped ? ` (skipped: ${report.skipped})` : ''}\n`)
for (const item of items.slice(0, 8)) {
  console.log(`· ${item.title || '(no title)'}`)
  console.log(`  ${item.text.slice(0, 160)}`)
  console.log(`  ${item.url || '(no url)'}${item.publishedAt ? ` · ${item.publishedAt.slice(0, 10)}` : ''}\n`)
}
process.exit(0)
