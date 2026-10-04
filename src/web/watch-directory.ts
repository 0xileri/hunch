import { readFileSync } from 'node:fs'
import type { Watch } from '../core/types.js'

export const WATCH_LIST_JS = readFileSync(new URL('./watch-list.js', import.meta.url), 'utf8')
// These exact terms belong to our existing deployment and screenshot fixtures.
const TEST_TERMS = new Set(['zzsmoketestentity', 'zzratecheckentity', 'zzhunchpathcheck', 'zzlatencycheckterm', 'zzscreenshotdemoterm'])
export function watchCategory(watch: Pick<Watch, 'house' | 'terms'>) {
  return watch.house ? 'demo' : watch.terms.some(term => TEST_TERMS.has(term.toLowerCase())) ? 'test' : 'project'
}

export function watchDirectory() {
  return `<section class="watch-directory">
    <div class="watch-directory-title"><div><span class="eyebrow">Project coverage</span><h1>Watches</h1><p>See your watch’s budget and progress. Open a project to follow its findings.</p></div><a class="watch-directory-cta" href="/watch">+ Open a watch</a></div>
    <div class="watch-directory-summary" id="watch-directory-summary" role="status">Loading watches…</div>
    <div class="watch-directory-tools"><div class="watch-directory-filters" role="group" aria-label="Filter watches">${[['active','Active'],['pending','Pending'],['demo','Demo & tests'],['all','All']].map(([key,label])=>`<button type="button" data-watch-filter="${key}" aria-pressed="${key==='active'}">${label}<span data-watch-count="${key}">0</span></button>`).join('')}</div><input id="watch-directory-search" type="search" placeholder="Find a project…" aria-label="Search watches" autocomplete="off"></div>
    <div class="watch-directory-grid" id="watch-directory-grid" aria-label="Project watches"><p class="muted">Loading project cards…</p></div>
    <div class="watch-directory-pagination" id="watch-directory-pagination" hidden><button class="small" type="button" id="watch-directory-prev">← Previous</button><span id="watch-directory-page" class="muted"></span><button class="small" type="button" id="watch-directory-next">Next →</button></div>
    <div class="watch-directory-bottom"><p id="watch-directory-update" class="muted" role="status" aria-live="polite"></p><button type="button" id="watch-directory-refresh" class="small">Refresh watches</button></div>
  </section>`
}
