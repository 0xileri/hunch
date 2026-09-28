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
