;(() => {
  const root=document.getElementById('investigation-report')
  const note=document.getElementById('report-update')
  const button=document.getElementById('report-refresh')
  let timer, busy=false, running=root.dataset.running==='true'
  async function refresh() {
    if(busy)return
    clearTimeout(timer);busy=true;button.disabled=true
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),15000)
    try {
      const response=await fetch('/api/investigations/'+encodeURIComponent(root.dataset.id)+'/report',{signal:controller.signal,cache:'no-store'})
      if(!response.ok)throw new Error('Report is temporarily unavailable. Try Refresh report.')
      const report=await response.json()
      const open=[...root.querySelectorAll('details[open]')].map(detail=>detail.dataset.reportDetail)
      if(root.innerHTML!==report.html)root.innerHTML=report.html
      for(const detail of root.querySelectorAll('details'))detail.open=open.includes(detail.dataset.reportDetail)
      running=report.running
      note.textContent=(running?'Live research · updated ':'Report checked ')+new Date().toLocaleTimeString()
    }catch(error){note.textContent=controller.signal.aborted?'Connection is slow. The report stays visible; use Refresh report to retry.':error.message}
    finally{clearTimeout(deadline);busy=false;button.disabled=false;if(running)timer=setTimeout(refresh,6000)}
  }
  button.addEventListener('click',refresh)
  if(running)timer=setTimeout(refresh,6000)
})()
