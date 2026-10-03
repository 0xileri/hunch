// Watch workspace: funding stays on chain; this page follows the recorded budget and findings.
;(() => {
  const $=id=>document.getElementById(id)
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
  const usd=n=>Number.isFinite(Number(n))?'$'+Number(n).toFixed(Math.abs(Number(n))<1?4:2):'—'
  const safeUrl=value=>/^https?:\/\//i.test(value||'')?esc(value):null
  const show=element=>{element.hidden=false}
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'—'
  let watchId=new URLSearchParams(location.search).get('id')
  let timer,loading=false,loaded=false
  const recentKey='hunch-recent-watches'
  function recent(watch) {
    try {
      let list=JSON.parse(localStorage.getItem(recentKey)||'[]')
      if(!Array.isArray(list))list=[]
      if(watch)list=[{id:watch.id,entity:watch.entity},...list.filter(item=>item.id!==watch.id)].slice(0,6)
      list=list.filter(item=>/^wat_(?:house|[a-f0-9]{8})$/.test(item.id)&&typeof item.entity==='string')
      if(watch)localStorage.setItem(recentKey,JSON.stringify(list))
      $('recent-watches').hidden=!list.length||!!watchId
      $('recent-watch-list').innerHTML=list.map(item=>'<a href="/watch?id='+encodeURIComponent(item.id)+'">'+esc(item.entity)+' →</a>').join('')
    }catch{}
  }
  recent()
  async function api(path,options={}) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000)
    try{
      const response=await fetch(path,{...options,signal:controller.signal,cache:'no-store'})
      const body=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(body.error||'Unable to load this watch. Try again.')
      return body
    }catch(error){throw new Error(controller.signal.aborted?'Connection is slow. Your watch stays saved; use Refresh status.':error.message)}
    finally{clearTimeout(timeout)}
  }
  $('form').addEventListener('submit',async event=>{
    event.preventDefault()
    const form=event.target,button=form.querySelector('button')
    if(!form.reportValidity())return
    const list=name=>form.elements[name].value.split(',').map(value=>value.trim()).filter(Boolean)
    $('err').textContent='';button.disabled=true;button.textContent='Opening watch…'
    try{
      const body=await api('/api/watch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({entity:form.elements.entity.value.trim(),terms:list('terms'),officialUrls:list('officialUrls'),owner:form.elements.owner.value.trim()})})
      watchId=body.watch.id
      history.replaceState(null,'','/watch?id='+encodeURIComponent(watchId))
      render(body);renderPayment(body,true);follow()
    }catch(error){$('err').textContent=error.message}
    finally{button.disabled=false;button.textContent='Open the watch'}
  })
  function renderPayment(body,scroll=false) {
    const payment=body.payment
    $('pay-id').textContent=body.watch.entity
    $('wid').textContent=payment.watchIdBytes32
    $('status-link').href='/watch?id='+encodeURIComponent(body.watch.id)+'#status'
    $('calldata').textContent=payment.calls?.fund||'Not available yet'
    if(window.__paySetup)window.__paySetup(payment)
    show($('pay'))
    if(scroll)$('pay').scrollIntoView({behavior:'smooth',block:'start'})
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-copy]')
    if(!button)return
    const text=button.dataset.copy==='watch-link'?location.origin+'/watch?id='+encodeURIComponent(watchId):$(button.dataset.copy).textContent.trim()
    try{
      await navigator.clipboard.writeText(text)
      const old=button.textContent;button.textContent='Copied'
      setTimeout(()=>button.textContent=old,1400)
    }catch{$('watch-update').textContent='Copy this watch link: '+location.origin+'/watch?id='+encodeURIComponent(watchId)}
  })
  async function follow() {
    if(!watchId||loading)return
    clearTimeout(timer);loading=true;$('watch-refresh').disabled=true
    try{
      const body=await api('/api/watch/'+encodeURIComponent(watchId))
      render(body)
      $('watch-update').textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes every 6 seconds'
    }catch(error){
      $('watch-update').textContent=error.message;show($('status'))
      if(!loaded){$('st-entity').textContent='Watch unavailable';$('watch-next').textContent=error.message}
    }
    finally{loading=false;$('watch-refresh').disabled=false;timer=setTimeout(follow,6000)}
  }
  $('watch-refresh').addEventListener('click',follow)
  const label=status=>({funded:'Queued for research',running:'Research in progress',verifying:'Verifying evidence',complete:'Research complete',rejected:'Verification needs review',failed:'Research failed',supported:'Supported',partially_supported:'Partially supported',unsupported:'Unsupported',unclear:'Unclear'})[status]||status
  function render(body) {
    loaded=true
    const w=body.watch,b=w.budget,investigations=body.investigations||[]
    const working=investigations.some(inv=>['funded','running','verifying'].includes(inv.state||inv.status))
    const ended=['expired','cancelled'].includes(w.status)||(w.expiresAt&&Date.parse(w.expiresAt)<Date.now())
    const phase=ended?'Watch ended':w.status==='pending'?'Awaiting funding':body.monitoring?.paused?'Agent paused':working?'Investigating':b.available<=0?'Reserve protected':body.monitoring?.scheduled===false?'Manual monitoring':'Monitoring'
    $('watch-setup').hidden=true;$('watch-hero').hidden=true;$('watch-how').hidden=true;$('recent-watches').hidden=true
    $('watch-workspace').hidden=false;$('st-entity').textContent=w.entity;$('st-id').textContent=w.id
    $('st-terms').textContent=w.terms.join(' · ')
    $('st-state').textContent=phase
    $('st-state').className='badge '+(ended?'':w.status==='pending'||working?'busy':body.monitoring?.paused||b.available<=0?'warn':'ok')
    document.title=w.entity+' · Hunch watch'
    const steps=['Watch created','Funding credited','Monitor narratives','Read investigations']
    const progress=w.status==='pending'?1:working||investigations.length?3:2
    $('watch-progress').innerHTML=steps.map((step,index)=>'<li class="'+(index<progress?'done':index===progress?'current':'')+'"'+(index===progress?' aria-current="step"':'')+'><span>'+(index+1)+'</span>'+step+'</li>').join('')
    const stat=(name,value)=>'<div class="stat"><div class="v">'+esc(value)+'</div><div class="l">'+name+'</div></div>'
    $('st-stats').innerHTML=[['Funded budget',usd(b.budgetUsd)],['Spent so far',usd(b.spentUsd)],['Budget remaining',usd(b.remaining)],['Ready for next investigation',usd(b.available)],['Protected reserve',usd(b.reserve)],['Research reports',String(investigations.length)]].map(([name,value])=>stat(name,value)).join('')
    $('watch-next').textContent=ended?'This watch has ended. Your findings and payment history remain available.':w.status==='pending'?'Next: fund this watch below. Monitoring begins when the payment is credited on chain.':body.monitoring?.paused?'The agent is paused. Your watch and remaining budget are saved.':working?'Hunch is researching a claim for this watch. Open the live report below to follow its progress.':b.available<=0?'No budget is available for another investigation. Hunch will preserve the reserve.':body.monitoring?.scheduled===false?'Automatic scans are off. Your watch records the results of manually requested scans.':'Hunch is monitoring. When a claim clears the risk and budget checks, its research report appears here.'
    $('watch-scan').textContent='Last public-feed scan: '+stamp(body.monitoring?.lastScanAt)+(w.expiresAt?' · Runs until '+stamp(w.expiresAt):'')
    $('watch-cost-note').textContent=usd(body.searchedUsd||0)+' spent on targeted search. Search and investigation costs are included in total spend.'
    if(w.status==='pending')renderPayment(body);else $('pay').hidden=true
    const seen=body.seen||[]
    $('st-seen').innerHTML='<h3>Narratives Hunch is watching</h3>'+(seen.length?'<ul class="w-seen">'+seen.map(item=>'<li><span class="badge">'+esc(item.action)+' · '+Number(item.score).toFixed(2)+'</span><div class="claim">'+esc(item.claim)+'</div><div class="m">'+Number(item.mentions)+' mentions · '+esc(item.sources.join(', '))+' · '+esc(stamp(item.at))+(safeUrl(item.links?.[0])?' · <a href="'+safeUrl(item.links[0])+'" target="_blank" rel="noopener noreferrer">Read source ↗</a>':'')+'</div><div class="m">'+esc(item.reason)+'</div>'+(item.investigationId?'<a href="/investigations/'+encodeURIComponent(item.investigationId)+'">Read investigation →</a>':'')+'</li>').join('')+'</ul>':'<p class="muted">'+(w.status==='pending'?'Narratives appear after your watch is funded.':ended?'No narratives were recorded for this watch.':'No matching narratives recorded yet. The latest scan and budget above show the current watch status.')+'</p>')
    $('st-invs').innerHTML='<h3>Investigations</h3>'+(investigations.length?'<ul class="w-invs">'+[...investigations].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5).map(inv=>'<li><a class="watch-report-link" href="/investigations/'+encodeURIComponent(inv.id)+'">'+esc(inv.claim)+' →</a><div class="m">'+esc(label(inv.accepted?inv.status:inv.state||inv.status))+' · '+usd(inv.spentUsd)+' spent'+(inv.accepted&&inv.confidence!==null?' · '+Math.round(inv.confidence*100)+'% confidence':'')+(inv.demo?' · Demo fixture':'')+' · '+esc(stamp(inv.at))+'</div></li>').join('')+'</ul><p><a href="/investigations?watch='+encodeURIComponent(w.id)+'">View all '+investigations.length+' investigations →</a></p>':'<p class="muted">'+(w.status==='pending'?'Funding comes first. No research has been commissioned.':'No investigations have run. Hunch will spend only when a claim clears its risk and budget checks.')+'</p>')
    $('watch-payments').innerHTML=w.payments.length?'<details><summary>On-chain funding history · '+w.payments.length+'</summary><ul class="w-seen">'+w.payments.map(payment=>'<li>'+Number(payment.amount).toLocaleString()+' '+esc(payment.tokenSymbol)+' · '+usd(payment.creditedUsd)+' credited'+(/^0x[a-fA-F0-9]{64}$/.test(payment.txHash)?' · <a href="https://robinhoodchain.blockscout.com/tx/'+payment.txHash+'" target="_blank" rel="noopener noreferrer">View receipt ↗</a>':'')+'</li>').join('')+'</ul></details>':''
    show($('status'));recent(w)
  }
  if(watchId){$('watch-setup').hidden=true;$('watch-hero').hidden=true;$('watch-how').hidden=true;show($('watch-workspace'));show($('status'));follow()}
})()

// ── paying from a wallet ────────────────────────────────────────────────────────────────────────
// Two calls, both built here: the token approves the payment contract, then the contract moves the
// tokens and tags them with this watch. The page never sees a key; the wallet signs each one.
;(() => {
  const $ = (id) => document.getElementById(id)
  const CHAIN = '0x1237' // Robinhood Chain, 4663
  let pay = null
  let account = null
  let pending = null
  let approved = null
  let walletVersion = 0
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
  const hashOk = hash => /^0x[a-fA-F0-9]{64}$/.test(hash)
  const pendingKey = () => 'hunch-watch-payment:' + pay.watchIdBytes32
  const buttonLabel = () => pending ? 'Check transaction' : account ? 'Fund watch' : 'Connect wallet'
  function remember(transaction) {
    pending = transaction
    try {
      if (transaction) localStorage.setItem(pendingKey(), JSON.stringify(transaction))
      else localStorage.removeItem(pendingKey())
    } catch {}
  }

  async function read(method, params = []) {
    let timeout
    try {
      return await Promise.race([
        window.ethereum.request({ method, params }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Wallet connection is slow. Check your wallet and retry.')), 10000) }),
      ])
    } finally { clearTimeout(timeout) }
  }
  async function correctChain() {
    if (Number(await read('eth_chainId')) !== Number(CHAIN)) {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN }] })
    }
    if (Number(await read('eth_chainId')) !== Number(CHAIN)) throw new Error('Switch your wallet to Robinhood Chain (4663) to fund this watch.')
  }
  async function sameWallet(from, version) {
    if (walletVersion !== version) throw new Error('Your wallet or network changed. Review the payment and try again.')
    if (Number(await read('eth_chainId')) !== Number(CHAIN)) throw new Error('Your network changed. Switch back to Robinhood Chain before funding.')
    const accounts = await read('eth_accounts')
    if (accounts[0]?.toLowerCase() !== from.toLowerCase() || walletVersion !== version) throw new Error('Your wallet account changed. Reconnect before funding.')
  }

  const pad = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  const padAddr = (a) => pad(a)
  /** A decimal amount in the token's own units, as a hex word. No floats: the string is the truth. */
  function units(amount, decimals) {
    const text = String(amount).trim()
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error('Enter a valid decimal amount.')
    const [whole = '0', frac = ''] = text.split('.')
    if (frac.length > decimals) throw new Error('This token supports up to ' + decimals + ' decimal places.')
    const padded = frac.padEnd(decimals, '0')
    const value = BigInt((whole || '0') + (padded || '')) 
    if (value <= 0n || value >= 2n ** 256n) throw new Error('Enter a positive amount within the token limit.')
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
    const unchanged = pay?.watchIdBytes32 === payment.watchIdBytes32
    const previousToken = $('pay-token').value, previousAmount = $('pay-amount').value
    pay = payment
    const select = $('pay-token')
    if (!select || !pay.ready) return
    select.innerHTML = tokens().map((t) => `<option value="${esc(t.token)}">${esc(t.symbol)}</option>`).join('')
    if (unchanged && tokens().some(t => t.token === previousToken)) select.value = previousToken
    $('pay-amount').value = unchanged ? previousAmount : String(pay.minAmount)
    if (!unchanged) {
      pending = null; approved = null
      try {
        const saved = JSON.parse(localStorage.getItem(pendingKey()) || 'null')
        if (saved && hashOk(saved.hash) && ['approve', 'fund'].includes(saved.stage)) pending = saved
      } catch {}
      if (pending) $('pay-status').innerHTML = 'Previous transaction awaiting verification: ' + tx(pending.hash)
    }
    if (!$('pay-go').disabled) $('pay-go').textContent = buttonLabel()
    worth()
  }

  document.addEventListener('input', (e) => {
    if (e.target && (e.target.id === 'pay-amount' || e.target.id === 'pay-token')) worth()
  })

  async function rpcWait(hash) {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const receipt = await read('eth_getTransactionReceipt', [hash])
      if (receipt?.status === '0x0' || receipt?.status === 0) {
        const error = new Error('The transaction failed on chain. Check the receipt before trying again.')
        error.reverted = true
        throw error
      }
      if (receipt?.status === '0x1' || receipt?.status === 1) return receipt
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error('Confirmation is taking longer than expected. Use Check transaction to verify the existing payment.')
  }

  const tx = hash => hashOk(hash) ? `<a href="https://robinhoodchain.blockscout.com/tx/${hash}" target="_blank" rel="noopener noreferrer">${hash.slice(0, 12)}…</a>` : 'Receipt unavailable'
  const walletChanged = () => { account = null; approved = null; walletVersion++; if (!$('pay-go').disabled) $('pay-go').textContent = buttonLabel() }
  window.ethereum?.on?.('accountsChanged', walletChanged)
  window.ethereum?.on?.('chainChanged', walletChanged)

  $('pay-go')?.addEventListener('click', async () => {
    const button = $('pay-go')
    $('pay-err').textContent = ''
    if (!window.ethereum) return ($('pay-err').textContent = 'Open this page in your wallet’s browser, or use the manual payment details.')
    if (!pay?.ready) return ($('pay-err').textContent = 'Watch payments are temporarily unavailable.')
    try {
      button.disabled = true
      $('pay-token').disabled = true; $('pay-amount').disabled = true
      if (pending) {
        await correctChain()
        $('pay-status').innerHTML = 'Checking the existing transaction ' + tx(pending.hash)
        await rpcWait(pending.hash)
        if (pending.stage === 'fund') {
          $('pay-status').innerHTML = 'Payment confirmed on chain ' + tx(pending.hash) + '. Hunch is verifying credit for this watch.'
        } else {
          approved = pending.context; remember(null)
          $('pay-status').textContent = 'Approval confirmed. Click Fund watch to complete the payment.'
        }
        return
      }
      if (!account) {
        button.textContent = 'Open your wallet…'
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
        if (!/^0x[a-fA-F0-9]{40}$/.test(accounts?.[0])) throw new Error('No wallet account connected.')
        await correctChain()
        const current = await read('eth_accounts')
        if (current[0]?.toLowerCase() !== accounts[0].toLowerCase()) throw new Error('Your account changed. Reconnect your wallet.')
        account = accounts[0]
        $('pay-status').textContent = `Connected as ${account.slice(0, 8)}…`
        return
      }
      await correctChain()
      if (!account) throw new Error('Your network changed. Reconnect your wallet before funding.')
      const t = chosen()
      if (!t) throw new Error('Select a supported token.')
      const value = units($('pay-amount').value, t.decimals)
      const from = account, version = walletVersion
      const context = [pay.watchIdBytes32, pay.contract.toLowerCase(), t.token.toLowerCase(), value.toString(), from.toLowerCase()].join(':')
      await sameWallet(from, version)

      if (approved !== context) {
        $('pay-status').textContent = `1 of 2: approve ${t.symbol} in your wallet…`
        const approveHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{ from, to: t.token, data: approveData(pay.contract, value), value: '0x0' }],
        })
        if (!hashOk(approveHash)) throw new Error('Your wallet did not return a transaction receipt. Check the wallet before retrying.')
        remember({ stage: 'approve', hash: approveHash, context })
        $('pay-status').innerHTML = `1 of 2: waiting for approval ${tx(approveHash)}`
        await rpcWait(approveHash)
        approved = context; remember(null)
      }

      await sameWallet(from, version)
      $('pay-status').textContent = '2 of 2: confirm funding in your wallet…'
      const fundHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: pay.contract, data: fundData(pay.watchIdBytes32, t.token, value), value: '0x0' }],
      })
      if (!hashOk(fundHash)) throw new Error('Your wallet did not return a transaction receipt. Check the wallet before retrying.')
      remember({ stage: 'fund', hash: fundHash })
      $('pay-status').innerHTML = 'Funding submitted; awaiting confirmation ' + tx(fundHash)
      await rpcWait(fundHash)
      $('pay-status').innerHTML = 'Payment confirmed on chain ' + tx(fundHash) + '. Hunch is verifying credit for this watch.'
    } catch (err) {
      if (err.reverted) { remember(null); approved = null }
      $('pay-err').textContent = err.code === 4001 ? 'Wallet request cancelled. No further payment was sent.' : err.message || String(err)
    } finally {
      button.disabled = false; button.textContent = buttonLabel()
      $('pay-token').disabled = false; $('pay-amount').disabled = false
    }
  })
})()
