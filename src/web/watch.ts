// The page where someone buys a watch: describe the project, open a watch, pay for it on chain,
// then follow what the agent found. The server never marks a watch paid — the agent reads the
// payment off the chain itself — so this page only collects a request and shows what to send.
import { readFileSync } from 'node:fs'
import { LAUNCHPAD, PUBLIC_URL, WATCH } from '../config.js'
import { CONTRACTS } from '../chain/refuel.js'
import { payContract } from '../chain/payments.js'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export const WATCH_JS = readFileSync(new URL('./watch.js', import.meta.url), 'utf8')

const WORDMARK =
  'M4 4V40M4 26A9 9 0 0 1 22 26V40M33 16V30A9 9 0 0 0 51 30M51 16V40M62 16V40M62 26A9 9 0 0 1 80 26V40M111.5 19.5A12 12 0 1 0 111.5 36.5M122.5 4V40M122.5 26A9 9 0 0 1 140.5 26V40'
const logo = `<svg class="logo" viewBox="4 4 214 56" role="img" aria-label="Hunch"><circle class="d1" cx="14" cy="46" r="4.5"/><circle class="d2" cx="27" cy="36" r="6.5"/><circle class="d3" cx="45" cy="22" r="10.5"/><path transform="translate(70 11)" d="${WORDMARK}" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

export function watchPage(): string {
  const live = Boolean(payContract())
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hunch · put a watch on your project</title>
<meta name="description" content="Pay Hunch to watch your project. Your payment becomes investigation budget, and the agent spends it only when a hunch is strong enough to prove.">
<meta name="theme-color" content="#07080a">
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/icon-32.png" sizes="32x32" type="image/png">
<meta property="og:title" content="Hunch: put a watch on your project">
<meta property="og:description" content="Your payment becomes investigation budget. The agent spends it only when a hunch is worth proving.">
<meta property="og:image" content="${PUBLIC_URL}/brand/og.png">
<meta property="og:url" content="${PUBLIC_URL}/watch">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>try { document.documentElement.dataset.theme = localStorage.getItem('hunch-theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }</script>
<link rel="stylesheet" href="/app.css?v=watch-reports-1">
</head>
<body class="watch-page">
<div class="backdrop" aria-hidden="true"><div class="gridlines"></div><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>

<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="/" aria-label="Hunch home">${logo}</a>
    <nav class="links" aria-label="Sections"><a href="/">Live console</a><a href="/airdrop">Supporter airdrop</a><a href="/demo">The fixture</a></nav>
  </div>
</header>

<main class="wrap">
  <section class="w-hero" id="watch-hero">
    <div class="eyebrow"><span class="live-dot"></span>${live ? 'Open for watches' : 'Not open yet'}</div>
    <h1>Put a watch on<br><span class="grad">your project.</span></h1>
    <p class="lede">Hunch reads public sources all day for free and scores what people are saying about you. When a claim starts spreading across independent sources, it pays for a real investigation and hands you the evidence, the confidence and the unknowns.</p>
  </section>

  <section class="w-how" id="watch-how">
    <div class="w-step"><span class="n">1</span><h3>Say what to watch</h3><p>Your project's name and the terms people actually use for it.</p></div>
    <div class="w-step"><span class="n">2</span><h3>Fund it in USDG</h3><p>Your payment becomes this watch's investigation budget, on chain 4663.</p></div>
    <div class="w-step"><span class="n">3</span><h3>Follow the evidence</h3><p>Public-feed checks are free. Targeted search and investigations use your prepaid budget.</p></div>
  </section>

  <section class="card" id="recent-watches" hidden><h2>Recently viewed watches</h2><div id="recent-watch-list" class="report-links"></div></section>
  <div class="w-grid" id="watch-setup">
    <section class="card" id="open">
      <h2>Open a watch</h2>
      <form id="form" novalidate>
        <label>Project name<input name="entity" required maxlength="60" placeholder="Acme Protocol" autocomplete="off"></label>
        <label>Terms to watch, comma separated
          <input name="terms" required placeholder="acme protocol, acmeprotocol, $acme" autocomplete="off">
          <small>What people type when they talk about you. At least 3 characters each, up to ${WATCH.maxTerms}.</small>
        </label>
        <label>Official pages, comma separated <span class="opt">optional</span>
          <input name="officialUrls" placeholder="https://status.acme.xyz, https://acme.xyz/blog" autocomplete="off">
          <small>Your status page and announcements. The cross-checker reads these as what you say, not as proof.</small>
        </label>
        <label>Your wallet address <span class="opt">optional</span>
          <input name="owner" placeholder="0x…" autocomplete="off" spellcheck="false">
          <small>The address you will pay from, so this watch shows up as yours.</small>
        </label>
        <button class="primary" type="submit" ${live ? '' : 'disabled'}>${live ? 'Open the watch' : 'Payments are not live yet'}</button>
        <p class="err" id="err" role="alert"></p>
      </form>
    </section>

    <section class="card" id="what">
      <h2>What you are buying</h2>
      <dl class="kv">
        <dt>Minimum</dt><dd>${WATCH.minUsdg} USDG</dd>
        <dt>Rate</dt><dd>1 USDG = $${WATCH.usdPerUsdg.toFixed(2)} of investigation budget</dd>
        <dt>Runs for</dt><dd>${WATCH.days} days, or until the budget is spent</dd>
        <dt>Typical investigation</dt><dd>about $0.02</dd>
        <dt>Public feeds, scoring, clustering</dt><dd>free, always</dd>
        <dt>Targeted web search</dt><dd>Metered against your watch's budget</dd>
      </dl>
      <p class="muted">You can also pay in <b>${esc(LAUNCHPAD.symbol)}</b> when a live rate is available. The wallet selector shows the estimated budget at the current quoted rate. Final credit uses Hunch’s payment policy; one payment credits at most $${WATCH.maxCreditPerPaymentUsd}.</p>
      <p class="muted">The agent keeps a fifth of your budget in reserve and never spends more than 15% of it on one investigation. Every cent it does spend is shown on the <a href="/">live console</a> with the balance before and after.</p>
      <p class="muted">Hunch reports a status, a confidence and what it could not resolve. It does not tell you a claim is true, and it never says a rumour is settled when it is not.</p>
    </section>
  </div>

  <section class="watch-workspace" id="watch-workspace" hidden><div class="watch-heading"><div><span class="eyebrow">Your project watch</span><h1 id="st-entity">Loading your watch…</h1><p id="st-terms" class="muted"></p><small id="st-id" class="mono"></small></div><div class="report-links"><button class="small" data-copy="watch-link" type="button">Copy watch link</button><a href="/watch">Open another watch →</a></div></div><ol class="watch-progress" id="watch-progress" aria-label="Watch progress"></ol><p id="watch-next" class="watch-next" role="status"></p></section>

  <section class="card w-pay" id="pay" hidden>
    <h2>Fund <span class="mono" id="pay-id"></span></h2>
    <p>Connect your wallet, choose a token and fund your watch on Robinhood Chain. Your watch begins when Hunch verifies and credits the payment.</p>

    <div class="w-payform">
      <h3>Pay from your wallet</h3>
      <div class="w-payrow">
        <label>Token<select id="pay-token"></select></label>
        <label>Amount<input id="pay-amount" inputmode="decimal" placeholder="2"></label>
        <button class="primary" id="pay-go">Connect wallet</button>
      </div>
      <p class="muted" id="pay-worth"></p>
      <p class="err" id="pay-err" role="alert"></p>
      <p class="muted" id="pay-status"></p>
    </div>
    <details class="watch-advanced"><summary>Manual payment details</summary><ol class="w-calls">
      <li>
        <div class="w-call-h">Approve USDG <button class="small copy" data-copy="usdg">Copy token</button></div>
        <code class="mono" id="usdg">${CONTRACTS.usdg}</code>
        <small>spender: <span class="mono" id="spender">${payContract() ?? '—'}</span></small>
      </li>
      <li>
        <div class="w-call-h">Call fund on HunchPay <button class="small copy" data-copy="contract">Copy contract</button></div>
        <code class="mono" id="contract">${payContract() ?? '—'}</code>
        <small>fund(<span class="mono" id="wid"></span>, <span class="mono">${CONTRACTS.usdg}</span>, amount)</small>
        <div class="w-call-h" style="margin-top:10px">Calldata for the minimum <button class="small copy" data-copy="calldata">Copy calldata</button></div>
        <code class="mono wrap-any" id="calldata"></code>
      </li>
    </ol></details>
    <p class="muted">Two calls: the token approves this contract, then the contract moves it. Paying from the address you gave keeps this watch tied to you. Nothing is held by the contract — it goes straight to Hunch's treasury, which buys the inference credit.</p>
    <p><a id="status-link" href="#">Follow this watch</a></p>
  </section>

  <section class="card w-status" id="status" hidden>
    <h2>Watch status <span class="badge" id="st-state">Loading</span><button class="small" id="watch-refresh" type="button">Refresh status</button></h2>
    <div class="stats" id="st-stats"></div>
    <p id="watch-scan" class="muted"></p><p id="watch-cost-note" class="muted"></p>
    <div id="st-seen"></div>
    <div id="st-invs"></div>
    <div id="watch-payments"></div><p id="watch-update" class="muted" role="status" aria-live="polite"></p>
  </section>
</main>

<footer>
  <div class="foot-base">Built for Orbio Build Week · every balance, cost and transaction shown is real</div>
</footer>
<script src="/watch.js?v=workspace-1"></script>
</body>
</html>`
}
