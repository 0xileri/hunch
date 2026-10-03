// What changed and when. The agent's pitch is that every decision it makes is visible; this is the
// same courtesy applied to the project itself. Newest first. Dates are the day it went live.
import { PUBLIC_URL, REPO_URL } from '../config.js'

export interface Change {
  date: string
  title: string
  body: string[]
  /** What it cost, what it found, what it proved: only numbers that were actually measured. */
  facts?: string[]
}

export const CHANGES: Change[] = [
  {
    date: '2026-10-03',
    title: 'From a watch to a readable investigation',
    body: [
      'Every project watch now has a workspace showing funding, monitoring, remaining budget, the latest scan and the next step. Your recently viewed watches are saved in your browser.',
      'Investigations have their own readable report pages with findings, source links, unknowns and actual research costs. Running reports refresh as workers progress; results that fail verification are clearly marked as drafts. Paginated history includes older reports beyond the console’s latest ten.',
      'Wallet funding stops when a chain switch is rejected or an approval fails. Pending transactions can be checked again without sending another payment, and entering an amount is no longer interrupted by status refreshes.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'It goes looking, and it shows you what it saw',
    body: [
      'Someone paid for a watch on a project that four crypto feeds were never going to mention. Everything downstream of the watcher was sound and pointed at the wrong haystack.',
      'A paid watch is now searched for by name through Orbio’s metered web search, on the agent’s own key and against that watch’s own budget. Looking is bounded: a cap per round, four hours between rounds, and an allowance of 30% of the watch, so the rest stays for proof.',
      'Their page used to show nothing at all unless an investigation ran, which made a week of correct restraint look identical to a week of doing nothing. It now lists every claim the agent clustered, what it scored, and why it passed.',
    ],
    facts: ['first round found four real mentions in minutes', 'all four scored 0.12–0.14 and cost nothing to pass on', '$0.0088 of the first customer’s dollar spent so far'],
  },
  {
    date: '2026-09-29',
    title: 'The token prices itself',
    body: [
      'Watches can be paid for in HUNCH as well as USDG. The rate was posted by hand, and within an hour it was wrong in both directions — at one point crediting 41% of what the tokens were worth.',
      'Payments in the token are now priced off recent trades plus a 20% bonus, read from the chain every scan. USDG is untouched at a dollar for a dollar: the token is the better way to pay, never the only way.',
      'Pricing no longer trusts a single pool address either, because liquidity moved once already — the launch curve, then an AMM.',
    ],
    facts: ['ORBIO priced from trades too, within 2% of CoinGecko', 'one payment can never credit more than $100'],
  },
  {
    date: '2026-09-29',
    title: 'Paid in a wallet, credited in a second',
    body: [
      'The watch page builds both calls itself — the token approves the contract, the contract moves it — so nobody has to paste calldata into a wallet.',
      'A watch used to be credited on the agent’s scan cycle, so someone could sit on a pending page for fifteen minutes with their money already sent. Opening a pending watch now checks the chain immediately.',
    ],
    facts: ['measured: credited one second after payment, down from up to fifteen minutes'],
  },
  {
    date: '2026-09-28',
    title: 'The agent has a token, and it pays for the work',
    body: [
      'Hunch launched on Orbio’s agent launchpad as agent #210, paired with ORBIO. Trading fees are collected by the vault, staked as ORBIO after its share, and that stake earns CREDIT.',
      'The agent claims that credit with its own key, on its own schedule, and spends it investigating. It cannot touch the staked principal: only the launching wallet can, and only after the cliff.',
    ],
  },
  {
    date: '2026-09-28',
    title: 'Watches: prepaid investigation budget, paid on chain',
    body: [
      'A watch is what Hunch sells. You name a project and the words people use for it, you pay, and that payment becomes the watch’s budget. The reserve and the per-investigation cap apply to your money exactly as they do to the house’s.',
      'Payment is a receipt, not a vault: the contract moves the token straight to the treasury and emits an event the agent reads. It never holds anyone’s money, so there is no balance to drain.',
    ],
    facts: ['a quiet week costs nothing', 'a full investigation runs about two cents'],
  },
  {
    date: '2026-09-19',
    title: 'It refuels itself',
    body: [
      'When its runway runs short the agent buys CREDIT with USDG from its own treasury on Robinhood Chain and activates it to its own Orbio account.',
      'The first automatic attempt was refused by the public RPC’s bot challenge. It now signs locally and broadcasts through fallback endpoints.',
    ],
    facts: ['two confirmed refuels, one on its own policy', '2 USDG bought $2.67 of inference, confirmed in the balance'],
  },
  {
    date: '2026-09-19',
    title: 'Workers bid for the job',
    body: [
      'The source-tracer and cross-checker are hired by auction: each worker bids its expected cost at real prices, and the best reputation per dollar wins. The verifier is appointed, because the judge should not be whoever bids lowest.',
      'Reputation is graded by code, not by a model. Did it name the true earliest post? Do its quotes appear word for word in the documents it cited?',
    ],
    facts: ['a worker that slipped below the quality floor stopped being hired'],
  },
  {
    date: '2026-09-18',
    title: 'Hunch, live on Orbio',
    body: [
      'An agent with a finite inference budget that watches public sources for free and pays for proof only when a hunch is strong enough. It holds its own Orbio key, mints and rotates it itself, and records every cent with the balance before and after.',
    ],
    facts: ['built for Orbio Build Week'],
  },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const WORDMARK =
  'M4 4V40M4 26A9 9 0 0 1 22 26V40M33 16V30A9 9 0 0 0 51 30M51 16V40M62 16V40M62 26A9 9 0 0 1 80 26V40M111.5 19.5A12 12 0 1 0 111.5 36.5M122.5 4V40M122.5 26A9 9 0 0 1 140.5 26V40'
const logo = `<svg class="logo" viewBox="4 4 214 56" role="img" aria-label="Hunch"><circle class="d1" cx="14" cy="46" r="4.5"/><circle class="d2" cx="27" cy="36" r="6.5"/><circle class="d3" cx="45" cy="22" r="10.5"/><path transform="translate(70 11)" d="${WORDMARK}" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export function changelogPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hunch · what changed</title>
<meta name="description" content="What changed in Hunch and when: the agent that watches public sources for free and pays for proof only when a hunch is strong enough.">
<meta name="theme-color" content="#07080a">
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">
<meta property="og:title" content="Hunch · what changed">
<meta property="og:description" content="Every change to the agent, dated, with what it cost and what it proved.">
<meta property="og:image" content="${PUBLIC_URL}/brand/og.png">
<meta property="og:url" content="${PUBLIC_URL}/changelog">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script>try { document.documentElement.dataset.theme = localStorage.getItem('hunch-theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }</script>
<link rel="stylesheet" href="/app.css">
</head>
<body class="watch-page">
<div class="backdrop" aria-hidden="true"><div class="gridlines"></div><div class="blob b1"></div><div class="blob b2"></div></div>
<header class="nav"><div class="nav-inner"><a class="brand" href="/" aria-label="Hunch home">${logo}</a>
  <nav class="links" aria-label="Sections"><a href="/">Live console</a><a href="/watch">Get watched</a>${REPO_URL ? `<a href="${esc(REPO_URL)}">Code</a>` : ''}</nav></div></header>

<main class="wrap">
  <section class="w-hero" style="padding-bottom:10px">
    <h1 style="font-size:clamp(2rem,4vw,2.9rem)">What changed</h1>
    <p class="lede">The agent shows every decision it makes and what that decision cost. This is the same, for the project itself.</p>
  </section>

  <ol class="cl">
    ${CHANGES.map(
      (c) => `<li class="cl-item">
      <div class="cl-when"><time datetime="${c.date}">${day(c.date)}</time></div>
      <div class="cl-what">
        <h2>${esc(c.title)}</h2>
        ${c.body.map((p) => `<p>${esc(p)}</p>`).join('')}
        ${c.facts?.length ? `<ul class="cl-facts">${c.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      </div>
    </li>`,
    ).join('')}
  </ol>

  <p class="muted" style="margin:26px 0 0">Every number here was measured on the live agent, not estimated. The demo narrative on the console is a planted fixture and says so; the treasury is funded by its operator, and the agent does not earn that part.</p>
</main>

<footer><div class="foot-base">Built for Orbio Build Week · every balance, cost and transaction shown is real</div></footer>
</body>
</html>`
}
