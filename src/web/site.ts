import { PUBLIC_URL } from '../config.js'
import { siteNavigation, SITE_CSS } from './navigation.js'

export const SECTION_PAGES = {
  signals: { title: 'Signals', description: 'What Hunch is watching, how it scores each narrative, and why it chooses to investigate.', panels: ['signal'] },
  investigations: { title: 'Investigations', description: 'Evidence, sources, findings and the real cost of checking a hunch.', panels: ['investigation'] },
  watches: { title: 'Watches', description: 'Project watches, their investigation budgets and their latest status.', panels: ['watches'] },
  market: { title: 'Worker market', description: 'The research workers Hunch hires, their bids and their track records.', panels: ['market'] },
  fuel: { title: 'Fuel & wallet', description: 'Orbio balance, agent keys, launchpad rewards and on-chain refueling.', panels: ['wallet'] },
  activity: { title: 'Activity', description: 'The agent’s latest actions, decisions and operational log.', panels: ['log'] },
  spend: { title: 'Spend ledger', description: 'Every paid call, its model, token usage and metered cost.', panels: ['spend'] },
  sources: { title: 'Sources', description: 'The public feeds Hunch reads and their current health.', panels: ['sources'] },
  background: { title: 'Background', description: 'Narratives outside the current mission and why they were passed over.', panels: ['background'] },
} as const
export type SectionPage = keyof typeof SECTION_PAGES
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const panel = (id: string) => `<section class="card${id === 'log' ? ' term' : ''}" id="${id}"><p class="muted" role="status">Loading live data…</p></section>`

export function sitePage(page: SectionPage | 'home' = 'home') {
  const home = page === 'home'
  const section = home ? null : SECTION_PAGES[page]
  const path = home ? '/' : `/${page}`
  const title = section?.title ?? 'Free hunches. Paid proof.'
  const description = section?.description ?? 'Hunch watches public sources and investigates emerging narratives when the evidence warrants it.'
  const content = home ? `<section class="site-hero"><span class="eyebrow" style="color:var(--accent)">Autonomous research, powered by Orbio</span><h1>Free hunches.<br><span style="color:var(--accent)">Paid proof.</span></h1><p>Hunch watches public sources, scores emerging narratives and pays for an investigation when a hunch is worth checking. Choose what you want to explore.</p><div class="site-controls"><a href="/watch">Put a watch on your project →</a><a href="/signals">Explore live signals</a></div></section>
  <section class="site-tiles" aria-label="Explore Hunch"><a class="site-tile" href="/signals"><strong>Signals →</strong><p>See what is emerging and why it matters.</p></a><a class="site-tile" href="/investigations"><strong>Investigations →</strong><p>Read the evidence and findings.</p></a><a class="site-tile" href="/airdrop"><strong style="color:var(--accent)">AIRDROP →</strong><p>Early supporters: register your existing posts. $$$ in $HUNCH, with allocations under review.</p></a></section>` : `<div class="site-title"><span class="eyebrow" style="color:var(--accent)">Hunch · Live data</span><h1>${escape(title)}</h1><p>${escape(description)}</p><div class="site-controls"><button type="button" id="btn-demo" class="primary">Run demo fixture</button><button type="button" id="btn-scan">Scan now</button><button type="button" id="btn-pause">Pause agent</button><button type="button" id="btn-theme">Light mode</button><span id="phase" class="phase" role="status">Connecting…</span></div><small class="muted">The demo uses planted posts about fictional Project X. <a href="/demo">See the fixture.</a></small></div><div class="site-panels">${section!.panels.map(panel).join('')}</div>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hunch · ${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#07080a"><meta property="og:title" content="Hunch · ${escape(title)}"><meta property="og:image" content="${PUBLIC_URL}/brand/og.png"><meta property="og:url" content="${PUBLIC_URL}${path}"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/brand/icon.svg"><link rel="stylesheet" href="/app.css"><script>try{document.documentElement.dataset.theme=localStorage.getItem('hunch-theme')||'dark'}catch{}</script><style>${SITE_CSS}</style></head><body>${siteNavigation(path)}<main class="site-main">${content}</main><footer class="site-footer">Free hunches. Paid proof. · <a href="https://x.com/hunchmode">@hunchmode</a> · <a href="/changelog">Updates</a> · <a href="/demo">Demo fixture</a></footer><div class="toast" id="toast" role="status"></div>${home ? '' : '<noscript><p class="noscript-note">Enable JavaScript to see live data.</p></noscript><script src="/app.js"></script>'}</body></html>`
}

export function howItWorksPage() {
  const steps = [
    ['Watch', 'Reads public feeds and embeds posts locally. Paid project watches can also fund metered searches.'],
    ['Score', 'Groups related claims and measures velocity, independent sources, severity and novelty.'],
    ['Decide', 'The coordinator checks the risk threshold, available budget, reserve and per-investigation cap.'],
    ['Investigate', 'Workers trace the origin and cross-check sources. A verifier reports the findings, confidence and unknowns.'],
    ['Refuel', 'When runway is low, the agent can buy and activate CREDIT on Robinhood Chain within its treasury policy.'],
  ]
  const body = `<main class="site-main"><div class="site-title"><span class="eyebrow" style="color:var(--accent)">From a feeling to evidence</span><h1>How Hunch works</h1><p>Free monitoring first. Paid research when a claim is worth checking.</p></div><div class="site-tiles">${steps.map(([title, text], i) => `<article class="site-tile"><strong>${i + 1}. ${title}</strong><p>${text}</p></article>`).join('')}</div><a class="site-watch" href="/watch">Open a watch →</a></main>`
  return sitePage().replace(/<main\b[^>]*>[\s\S]*?<\/main>/, body).replace(siteNavigation('/'), siteNavigation('/how-it-works')).replace('<title>Hunch · Free hunches. Paid proof.</title>', '<title>Hunch · How it works</title>').replace(`content="${PUBLIC_URL}/"`, `content="${PUBLIC_URL}/how-it-works"`)
}
