// The watch page: open one, show how to pay for it, then follow it. Everything shown here comes
// from the API; the page never decides that a watch is funded.
;(() => {
  const $ = (id) => document.getElementById(id)
  const usd = (n) => `$${Number(n).toFixed(Number(n) < 1 ? 4 : 2)}`
  const show = (el) => el.removeAttribute('hidden')

  let watchId = new URLSearchParams(location.search).get('id')
  let timer

  async function api(path, options) {
    const res = await fetch(path, options)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  // ── open ──────────────────────────────────────────────────────────────────────────────────────
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const button = form.querySelector('button')
    const list = (name) =>
      (form.elements[name].value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    $('err').textContent = ''
    button.disabled = true
    try {
      const body = await api('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entity: form.elements.entity.value.trim(),
          terms: list('terms'),
          officialUrls: list('officialUrls'),
          owner: form.elements.owner.value.trim(),
        }),
      })
      watchId = body.watch.id
      history.replaceState(null, '', `/watch?id=${watchId}`)
      renderPayment(body)
      follow()
    } catch (err) {
      $('err').textContent = err.message
    } finally {
      button.disabled = false
    }
  })

  function renderPayment(body) {
    const pay = body.payment
    $('pay-id').textContent = body.watch.id
    $('wid').textContent = pay.watchIdBytes32
    $('status-link').href = `/watch?id=${body.watch.id}`
    if (pay.calls) $('calldata').textContent = pay.calls.fund
    if (window.__paySetup) window.__paySetup(pay)
    show($('pay'))
    $('pay').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  document.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-copy]')
    if (!button) return
    const text = $(button.dataset.copy).textContent.trim()
    try {
      await navigator.clipboard.writeText(text)
      const was = button.textContent
      button.textContent = 'Copied'
      setTimeout(() => (button.textContent = was), 1400)
    } catch {
      /* clipboard blocked: the value is on screen to copy by hand */
    }
  })

  // ── follow ────────────────────────────────────────────────────────────────────────────────────
  async function follow() {
    if (!watchId) return
    clearTimeout(timer)
    try {
      const body = await api(`/api/watch/${watchId}`)
      render(body)
    } catch (err) {
      $('st-state').textContent = err.message
    }
    timer = setTimeout(follow, 6000)
  }

  function render(body) {
    const w = body.watch
    const b = w.budget
    $('st-id').textContent = w.id
    $('st-state').textContent = w.status
    $('st-state').className = `badge ${w.status === 'active' ? 'ok' : w.status === 'pending' ? 'busy' : ''}`
    $('st-stats').innerHTML = [
      ['entity', w.entity],
      ['funded', usd(b.budgetUsd)],
      ['spent', usd(b.spentUsd)],
      ['available now', usd(b.available)],
      ['investigations', String(body.investigations.length)],
      ['runs until', w.expiresAt ? w.expiresAt.slice(0, 10) : '—'],
    ]
      .map(([label, value]) => `<div class="stat"><div class="v">${value}</div><div class="l">${label}</div></div>`)
      .join('')

    // What it saw, including what it decided not to pay for: a quiet week is the product working.
    const seen = body.seen || []
    const badge = (a) => (a === 'INVESTIGATE' ? 'ok' : a === 'WATCH' ? 'busy' : '')
    $('st-seen').innerHTML = seen.length
      ? `<h3>What it has seen <span class="muted">· ${seen.length} claim${seen.length === 1 ? '' : 's'}, ${usd(body.searchedUsd || 0, 4)} spent looking</span></h3>
         <ul class="w-seen">${seen
           .map(
             (s) =>
               `<li><span class="badge ${badge(s.action)}">${s.score.toFixed(2)} ${s.action}</span>
                 <div class="claim">${s.claim}</div>
                 <div class="m">${s.mentions} mention${s.mentions === 1 ? '' : 's'} · ${s.sources.join(', ')} · ${new Date(s.at).toLocaleString()}
                 ${s.links.length ? ` · <a href="${s.links[0]}" target="_blank" rel="noopener">open</a>` : ''}</div>
                 <div class="m">${s.reason}</div></li>`,
           )
           .join('')}</ul>`
      : w.status === 'active'
        ? `<h3>What it has seen</h3><p class="muted">Nothing yet. It looks for ${w.terms.map((t) => `"${t}"`).join(', ')} every few hours and reads its public feeds every 15 minutes.</p>`
        : ''

    $('st-invs').innerHTML = body.investigations.length
      ? `<ul class="w-invs">${body.investigations
          .map(
            (i) =>
              `<li><a href="/api/investigations/${i.id}">${i.id}</a> · ${new Date(i.at).toLocaleString()} · ${usd(i.spentUsd)} · <b>${String(
                i.status,
              ).replace('_', ' ')}</b>${i.confidence !== null ? ` at ${Math.round(i.confidence * 100)}%` : ''}<div class="claim">${i.claim}</div></li>`,
          )
          .join('')}</ul>`
      : `<p class="muted">${
          w.status === 'pending'
            ? 'Nothing yet: this watch starts once its payment lands on chain.'
            : 'Watching. Nothing has crossed the threshold, so nothing has been paid for.'
        }</p>`
    show($('status'))
  }

  if (watchId) {
    api(`/api/watch/${watchId}`)
      .then((body) => {
        if (body.watch.status === 'pending') renderPayment(body)
        render(body)
        follow()
      })
      .catch((err) => {
        $('err').textContent = err.message
      })
  }
})()

// ── paying from a wallet ────────────────────────────────────────────────────────────────────────
// Two calls, both built here: the token approves the payment contract, then the contract moves the
// tokens and tags them with this watch. The page never sees a key; the wallet signs each one.
;(() => {
  const $ = (id) => document.getElementById(id)
  const CHAIN = '0x1237' // 4663
  let pay = null
  let account = null

  const pad = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  const padAddr = (a) => pad(a)
  /** A decimal amount in the token's own units, as a hex word. No floats: the string is the truth. */
  function units(amount, decimals) {
    const [whole = '0', frac = ''] = String(amount).trim().split('.')
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) throw new Error('that is not a number')
    const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
    const value = BigInt((whole || '0') + (padded || '')) 
    if (value <= 0n) throw new Error('enter an amount above zero')
    return value
  }
  const approveData = (spender, value) => '0x095ea7b3' + padAddr(spender) + pad(value.toString(16))
  const fundData = (watchId32, token, value) => '0xf8388f0f' + pad(watchId32) + padAddr(token) + pad(value.toString(16))

  const tokens = () => {
    if (!pay) return []
    return [{ token: pay.token, symbol: pay.tokenSymbol, decimals: pay.decimals, usdPerUnit: pay.usdPerUnit }, ...(pay.alsoAccepts || [])]
  }
  const chosen = () => tokens().find((t) => t.token.toLowerCase() === $('pay-token').value.toLowerCase())

  function worth() {
    const t = chosen()
    const raw = $('pay-amount').value
    if (!t || !raw) return ($('pay-worth').textContent = '')
    const n = Number(raw)
    $('pay-worth').textContent =
      Number.isFinite(n) && n > 0 ? `${n.toLocaleString()} ${t.symbol} buys about $${(n * t.usdPerUnit).toFixed(2)} of investigation budget.` : ''
  }

  window.__paySetup = (payment) => {
    pay = payment
    const select = $('pay-token')
    if (!select || !pay.ready) return
    select.innerHTML = tokens().map((t) => `<option value="${t.token}">${t.symbol}</option>`).join('')
    $('pay-amount').value = String(pay.minAmount)
    worth()
  }

  document.addEventListener('input', (e) => {
    if (e.target && (e.target.id === 'pay-amount' || e.target.id === 'pay-token')) worth()
  })

  async function rpcWait(hash) {
    for (let i = 0; i < 60; i++) {
      const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null)
      if (receipt) return receipt
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error('the transaction is taking longer than expected; check your wallet')
  }

  const tx = (url, hash) => `<a href="https://robinhoodchain.blockscout.com/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 12)}…</a>`

  $('pay-go')?.addEventListener('click', async () => {
    const button = $('pay-go')
    $('pay-err').textContent = ''
    if (!window.ethereum) return ($('pay-err').textContent = 'No wallet in this browser. The calls are listed above to send by hand.')
    try {
      button.disabled = true
      if (!account) {
        ;[account] = await window.ethereum.request({ method: 'eth_requestAccounts' })
        try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN }] }) } catch {}
        button.textContent = 'Pay'
        $('pay-status').textContent = `Connected as ${account.slice(0, 8)}…`
        return
      }
      const t = chosen()
      const value = units($('pay-amount').value, t.decimals)

      $('pay-status').innerHTML = `1 of 2: approving ${t.symbol}…`
      const approveHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: t.token, data: approveData(pay.contract, value), value: '0x0' }],
      })
      $('pay-status').innerHTML = `1 of 2: approving ${t.symbol} ${tx(0, approveHash)}`
      await rpcWait(approveHash)

      $('pay-status').innerHTML = `2 of 2: funding the watch…`
      const fundHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: pay.contract, data: fundData(pay.watchIdBytes32, t.token, value), value: '0x0' }],
      })
      $('pay-status').innerHTML = `Paid ${tx(0, fundHash)}. The agent credits it on its next scan, within a minute or two.`
      await rpcWait(fundHash)
    } catch (err) {
      $('pay-err').textContent = err.message || String(err)
    } finally {
      button.disabled = false
    }
  })
})()
