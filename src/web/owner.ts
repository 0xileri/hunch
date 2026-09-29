// A small console for whoever owns HunchPay. It holds no secrets and needs no token: the contract
// itself decides, and only the owner's signature gets through. Everything here is a wallet call.
import { WATCH, LAUNCHPAD, PUBLIC_URL } from '../config.js'
import { CONTRACTS } from '../chain/refuel.js'

const WORDMARK =
  'M4 4V40M4 26A9 9 0 0 1 22 26V40M33 16V30A9 9 0 0 0 51 30M51 16V40M62 16V40M62 26A9 9 0 0 1 80 26V40M111.5 19.5A12 12 0 1 0 111.5 36.5M122.5 4V40M122.5 26A9 9 0 0 1 140.5 26V40'
const logo = `<svg class="logo" viewBox="4 4 214 56" role="img" aria-label="Hunch"><circle class="d1" cx="14" cy="46" r="4.5"/><circle class="d2" cx="27" cy="36" r="6.5"/><circle class="d3" cx="45" cy="22" r="10.5"/><path transform="translate(70 11)" d="${WORDMARK}" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

export function ownerPage(): string {
  const pay = WATCH.contract ?? ''
  const token = LAUNCHPAD.token ?? ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hunch · owner console</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#07080a">
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script>try { document.documentElement.dataset.theme = localStorage.getItem('hunch-theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }</script>
<link rel="stylesheet" href="/app.css">
</head>
<body class="watch-page">
<div class="backdrop" aria-hidden="true"><div class="gridlines"></div><div class="blob b1"></div><div class="blob b2"></div></div>
<header class="nav"><div class="nav-inner"><a class="brand" href="/" aria-label="Hunch home">${logo}</a>
  <nav class="links" aria-label="Sections"><a href="/">Live console</a><a href="/watch">Watches</a></nav></div></header>

<main class="wrap">
  <section class="w-hero" style="padding-bottom:18px">
    <h1 style="font-size:clamp(2rem,4vw,2.8rem)">Owner console</h1>
    <p class="lede">Settings on the payment contract. Your wallet signs; nothing here can act on its own, and the contract refuses anyone who is not the owner.</p>
  </section>

  <section class="card">
    <h2>HunchPay <span class="right mono" style="font-size:.75rem">${pay.slice(0, 10)}…</span></h2>
    <dl class="kv">
      <dt>Contract</dt><dd class="mono">${pay}</dd>
      <dt>Owner</dt><dd class="mono" id="owner">reading…</dd>
      <dt>Treasury</dt><dd class="mono" id="treasury">reading…</dd>
      <dt>USDG accepted</dt><dd id="usdg">reading…</dd>
      <dt>${LAUNCHPAD.symbol} accepted</dt><dd id="hunch">reading…</dd>
      <dt>Your wallet</dt><dd class="mono" id="wallet">not connected</dd>
    </dl>

    <div class="cta" style="margin-top:16px">
      <button class="glass" id="connect">Connect wallet</button>
      <button class="primary" id="accept" disabled>Accept ${LAUNCHPAD.symbol} for watches</button>
      <button class="ghost" id="revoke" disabled>Stop accepting ${LAUNCHPAD.symbol}</button>
    </div>
    <p class="err" id="err" role="alert"></p>
    <p class="muted" id="done" style="font-size:.85rem"></p>

    <p class="muted" style="font-size:.8rem;margin-top:14px">Accepting the token lets anyone fund a watch with ${LAUNCHPAD.symbol} at the posted rate. The agent credits it at market value instead whenever the posted rate has drifted too far, so a rate left to go stale cannot be farmed.</p>
  </section>

  <section class="card" style="margin-top:16px">
    <h2>If your wallet cannot open this page</h2>
    <p class="muted">Send the call by hand from the owner address. No value, just data.</p>
    <ol class="w-calls">
      <li>
        <div class="w-call-h">To <button class="small copy" data-copy="raw-to">Copy</button></div>
        <code class="mono" id="raw-to">${pay}</code>
      </li>
      <li>
        <div class="w-call-h">Data · accept ${LAUNCHPAD.symbol} <button class="small copy" data-copy="raw-accept">Copy</button></div>
        <code class="mono wrap-any" id="raw-accept"></code>
        <small>setAccepted(${token}, true) on chain 4663</small>
      </li>
    </ol>
  </section>
</main>

<footer><div class="foot-base">The owner console holds no keys. Chain 4663 · Robinhood Chain</div></footer>
<script>
const PAY = ${JSON.stringify(pay)};
const TOKEN = ${JSON.stringify(token)};
const USDG = ${JSON.stringify(CONTRACTS.usdg)};
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = '0x1237'; // 4663
const SEL = { owner: '0x8da5cb5b', treasury: '0x61d027b3', accepted: '0x2b34af70' };
const pad = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');
const acceptedData = (t) => '0x6227d787' + pad(t) + '1'.padStart(64, '0');
const revokeData = (t) => '0x6227d787' + pad(t) + '0'.padStart(64, '0');
const $ = (id) => document.getElementById(id);
$('raw-accept').textContent = acceptedData(TOKEN);

async function rpc(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
const callPay = (data) => rpc('eth_call', [{ to: PAY, data }, 'latest']);
const asAddr = (word) => '0x' + word.slice(-40);
const asBool = (word) => BigInt(word) === 1n;

async function refresh() {
  try {
    const [owner, treasury, usdg, hunch] = await Promise.all([
      callPay(SEL.owner),
      callPay(SEL.treasury),
      callPay(SEL.accepted + pad(USDG)),
      TOKEN ? callPay(SEL.accepted + pad(TOKEN)) : Promise.resolve(null),
    ]);
    $('owner').textContent = asAddr(owner);
    $('treasury').textContent = asAddr(treasury);
    $('usdg').textContent = asBool(usdg) ? 'yes' : 'no';
    $('hunch').textContent = !TOKEN ? 'no token configured' : asBool(hunch) ? 'yes' : 'not yet — the contract refuses it, so nobody can pay in it';
    window.__owner = asAddr(owner).toLowerCase();
  } catch (err) { $('err').textContent = 'Could not read the contract: ' + err.message; }
}

$('connect').addEventListener('click', async () => {
  $('err').textContent = '';
  if (!window.ethereum) { $('err').textContent = 'No wallet in this browser. Use the raw call below from the owner address.'; return; }
  try {
    const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    $('wallet').textContent = account;
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN }] }); } catch {}
    const isOwner = account.toLowerCase() === window.__owner;
    $('accept').disabled = !isOwner;
    $('revoke').disabled = !isOwner;
    if (!isOwner) $('err').textContent = 'That wallet is not the owner, so the contract would refuse it. Connect ' + window.__owner + '.';
  } catch (err) { $('err').textContent = err.message; }
});

async function send(data, what) {
  $('err').textContent = ''; $('done').textContent = '';
  try {
    const from = $('wallet').textContent;
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: PAY, data, value: '0x0' }] });
    $('done').innerHTML = what + ' sent: <a href="https://robinhoodchain.blockscout.com/tx/' + hash + '" target="_blank" rel="noopener">' + hash.slice(0, 18) + '…</a>. It takes a few seconds.';
    setTimeout(refresh, 6000);
  } catch (err) { $('err').textContent = err.message; }
}
$('accept').addEventListener('click', () => send(acceptedData(TOKEN), 'Accepting ' + ${JSON.stringify(LAUNCHPAD.symbol)}));
$('revoke').addEventListener('click', () => send(revokeData(TOKEN), 'Stopping ' + ${JSON.stringify(LAUNCHPAD.symbol)}));
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try { await navigator.clipboard.writeText($(b.dataset.copy).textContent.trim()); const was = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = was), 1400); } catch {}
});
refresh();
</script>
</body>
</html>`
}
