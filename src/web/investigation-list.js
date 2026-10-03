;(() => {
  const root = document.getElementById('investigation')
  const note = document.getElementById('reports-update')
  const refresh = document.getElementById('reports-refresh')
  const watchId = new URLSearchParams(location.search).get('watch')
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
  const labels = { funded:'Queued for research', running:'Research in progress', verifying:'Verifying evidence', complete:'Research complete', rejected:'Verification needs review', failed:'Research failed', supported:'Supported', partially_supported:'Partially supported', unsupported:'Unsupported', unclear:'Unclear' }
  let items = [], nextOffset = null, total = 0, busy = false, timer
  function render() {
    root.innerHTML = '<h2>Research reports <span class="badge">'+total+'</span></h2>'+(watchId?'<p><a href="/watch?id='+encodeURIComponent(watchId)+'">← Follow this watch</a> · <a href="/investigations">Browse all reports</a></p>':'')+(items.length?'<ul class="report-directory">'+items.map(inv=>'<li><a class="watch-report-link" href="/investigations/'+encodeURIComponent(inv.id)+'">'+esc(inv.claim)+' →</a><p class="muted">'+esc(labels[inv.verdict||inv.status]||inv.status)+(inv.accepted&&inv.confidence!==null?' · '+Math.round(inv.confidence*100)+'% confidence':'')+' · $'+Number(inv.spentUsd).toFixed(4)+' spent'+(inv.demo?' · Demo fixture':'')+'</p><div class="report-links">'+(inv.watchId?'<a href="/watch?id='+encodeURIComponent(inv.watchId)+'">Follow watch →</a>':'')+'<span class="mono muted">'+esc(new Date(inv.createdAt).toLocaleString())+'</span></div></li>').join('')+'</ul>':'<p class="empty">No research reports yet. When a watch triggers an investigation, its live report appears here.</p><a href="/watch">Open a project watch →</a>')+(nextOffset!==null?'<button type="button" id="reports-more">Load more reports</button>':'')
  }
  async function load(more = false) {
    if (busy) return
    busy = true; clearTimeout(timer); refresh.disabled = true
    const moreButton = document.getElementById('reports-more')
    if (moreButton) moreButton.disabled = true
    const controller = new AbortController(), deadline = setTimeout(()=>controller.abort(),15000)
    try {
      const query = new URLSearchParams({ offset: String(more ? nextOffset : 0) })
      if(watchId)query.set('watch',watchId)
      const response = await fetch('/api/investigations?'+query,{cache:'no-store',signal:controller.signal})
      const body = await response.json()
      if(!response.ok)throw new Error(body.error||'Reports are temporarily unavailable.')
      items = more ? [...items, ...body.items.filter(inv=>!items.some(old=>old.id===inv.id))] : body.items
      nextOffset = body.nextOffset; total = body.total
      render()
      note.textContent = 'Showing '+items.length+' of '+total+' · updated '+new Date().toLocaleTimeString()
      // Do not collapse an expanded history during a background refresh.
      if(items.length<=20&&items.some(inv=>['funded','running','verifying'].includes(inv.status)))timer=setTimeout(()=>load(),10000)
    } catch(error) {
      note.textContent = controller.signal.aborted?'Connection is slow. Your reports stay visible; use Refresh reports.':error.message
      if(moreButton)moreButton.disabled=false
    } finally { clearTimeout(deadline); busy=false; refresh.disabled=false }
  }
  refresh.addEventListener('click',()=>load())
  root.addEventListener('click',event=>{if(event.target.closest('#reports-more'))load(true)})
  load()
})()
