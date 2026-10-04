;(() => {
  const $ = id => document.getElementById(id)
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
  const money = (value, digits = 2) => '$' + Number(value || 0).toFixed(digits)
  const filters = [...document.querySelectorAll('[data-watch-filter]')]
  const query = new URLSearchParams(location.search)
  let view = ['active','pending','demo','all'].includes(query.get('view')) ? query.get('view') : 'active'
  let watches = [], busy = false, timer, page = 0
  const category = watch => watch.category || (watch.house ? 'demo' : 'project')
  const ended = watch => ['expired','cancelled'].includes(watch.status) || watch.expiresAt && Date.parse(watch.expiresAt) <= Date.now()
  const active = watch => watch.status === 'active' && Number(watch.budget.budgetUsd) > 0 && !ended(watch)
  function group(key) {
    if(key === 'all')return watches
    if(key === 'demo')return watches.filter(watch=>category(watch)!=='project')
    return watches.filter(watch=>category(watch)==='project'&&(key==='active'?active(watch):watch.status==='pending'&&!ended(watch)))
  }
  function card(watch) {
    const budget = watch.budget, funded = Number(budget.budgetUsd)>0
    const status = watch.status === 'cancelled' ? 'Cancelled' : ended(watch) ? 'Expired' : watch.status === 'pending' ? 'Awaiting funding' : 'Active'
    const badge = status === 'Active' ? 'ok' : status === 'Awaiting funding' ? 'busy' : ''
    const fraction = funded ? Math.max(0,Math.min(100,Number(budget.spentUsd)/Number(budget.budgetUsd)*100)) : 0
    const link = '/watch?id='+encodeURIComponent(watch.id)
    const reports = Number(watch.investigations || 0)
    return `<article class="watch-tile"><div class="watch-tile-top"><span class="watch-tile-mark" aria-hidden="true">${esc(watch.entity.trim().slice(0,1).toUpperCase())}</span><span class="badge ${badge}">${status}</span></div>${category(watch)!=='project'?`<small class="watch-tile-kind">${category(watch)==='demo'?'Demo fixture':'Test watch'}</small>`:''}<h2><a href="${link}">${esc(watch.entity)}</a></h2><div class="watch-tile-terms">${watch.terms.slice(0,3).map(term=>'<span>'+esc(term)+'</span>').join('')}${watch.terms.length>3?'<span>+'+(watch.terms.length-3)+'</span>':''}</div>${funded?`<div class="watch-tile-money"><div><small>${category(watch)==='demo'?'Demo budget':'Funded'}</small><strong>${money(budget.budgetUsd)}</strong></div><div><small>Remaining</small><strong>${money(budget.remaining)}</strong></div></div><div class="watch-tile-spend"><span>${money(budget.spentUsd,4)} spent</span><span>${Math.round(fraction)}% used</span></div><div class="bar watch-tile-bar" aria-label="${Math.round(fraction)} percent of budget used"><i style="width:${fraction}%"></i></div>`:'<p class="watch-tile-pending">Fund this watch to start monitoring and research.</p>'}<div class="watch-tile-bottom"><span>${reports} report${reports===1?'':'s'}${watch.expiresAt?' · '+(ended(watch)?'Ended ':'Until ')+esc(new Date(watch.expiresAt).toLocaleDateString(undefined,{day:'numeric',month:'short'})):''}</span><a href="${link}">${watch.status==='pending'?'Fund watch':'Open watch'} →</a></div></article>`
  }
  function render() {
    const projects = watches.filter(watch=>category(watch)==='project')
    const funded = projects.filter(watch=>Number(watch.budget.budgetUsd)>0)
    $('watch-directory-summary').innerHTML='<span><strong>'+group('active').length+'</strong> active project'+(group('active').length===1?'':'s')+'</span><span><strong>'+group('pending').length+'</strong> awaiting funding</span><span><strong>'+money(funded.reduce((sum,watch)=>sum+Number(watch.budget.budgetUsd),0))+'</strong> project funding</span>'
    for(const button of filters){button.setAttribute('aria-pressed',String(button.dataset.watchFilter===view));button.querySelector('[data-watch-count]').textContent=String(group(button.dataset.watchFilter).length)}
    const search=$('watch-directory-search').value.trim().toLowerCase()
    const list=group(view).filter(watch=>[watch.entity,...watch.terms].some(value=>value.toLowerCase().includes(search))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    const pages=Math.ceil(list.length/6)
    page=Math.max(0,Math.min(page,pages-1))
    const html=list.length?list.slice(page*6,(page+1)*6).map(card).join(''):'<div class="watch-directory-empty"><strong>'+(search?'No matching projects':view==='active'?'No active project watches':view==='pending'?'No watches awaiting funding':'No watches here yet')+'</strong><p>'+(search?'Try another name or term.':view==='active'?'Fund a pending watch or open a new one to get started.':'Choose another filter or open a new watch.')+'</p><a href="/watch">Open a watch →</a></div>'
    if($('watch-directory-grid').innerHTML!==html)$('watch-directory-grid').innerHTML=html
    $('watch-directory-pagination').hidden=pages<=1
    $('watch-directory-page').textContent='Page '+(page+1)+' of '+pages
    $('watch-directory-prev').disabled=page===0
    $('watch-directory-next').disabled=page>=pages-1
  }
  for(const button of filters)button.addEventListener('click',()=>{view=button.dataset.watchFilter;page=0;query.set('view',view);history.replaceState(null,'','/watches?'+query);render()})
  $('watch-directory-search').addEventListener('input',()=>{page=0;render()})
  const turnPage=change=>{page+=change;render();$('watch-directory-grid').scrollIntoView({block:'start',behavior:'smooth'})}
  $('watch-directory-prev').addEventListener('click',()=>turnPage(-1))
  $('watch-directory-next').addEventListener('click',()=>turnPage(1))
  async function refresh() {
    if(busy)return
    busy=true;clearTimeout(timer);$('watch-directory-refresh').disabled=true
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),15000)
    try {
      const response=await fetch('/api/watches',{cache:'no-store',signal:controller.signal})
      if(!response.ok)throw new Error('Watches are temporarily unavailable. Use Refresh watches to retry.')
      watches=await response.json();render()
      $('watch-directory-update').textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes every 10 seconds'
    }catch(error){$('watch-directory-update').textContent=controller.signal.aborted?'Connection is slow. Use Refresh watches to retry.':error.message}
    finally{clearTimeout(deadline);busy=false;$('watch-directory-refresh').disabled=false;timer=setTimeout(refresh,10000)}
  }
  $('watch-directory-refresh').addEventListener('click',refresh)
  refresh()
})()
