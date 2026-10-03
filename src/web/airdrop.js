(() => {
  const $ = id => document.getElementById(id)
  let wallet = null
  let busy = false
  let accountVersion = 0
  let provider = null
  let connecting = false
  let eligible = null
  let claimsOpen = false
  let matchedHandle = null
  let claimState = null
  const discovered = new Map()
  const status = text => { $('airdrop-status').textContent = text }
  const reset = () => { wallet = null; eligible = null; matchedHandle = null; claimState = null; $('not-eligible').close(); $('claim-amount').textContent = ''; accountVersion++; $('submit-entry').disabled = true; $('claim-panel').hidden = false; $('claim-reward').disabled = false; $('claim-follows').checked = false; $('claim-handle').value = ''; hideReward(); $('airdrop-form').hidden = false; $('wallet-state').textContent = 'Wallet changed. Connect again to continue.'; $('connect-wallet').textContent = 'Connect wallet'; status('') }
  // Mobile wallets can re-announce the same account on returning from a signature prompt.
  // Only invalidate a submission when the actual selected account changed or disappeared.
  const accountsChanged = accounts => {
    if (wallet && Array.isArray(accounts) && typeof accounts[0] === 'string' && accounts[0].toLowerCase() === wallet.toLowerCase()) return
    reset()
  }
  function hideReward() { $('share-reward').close(); $('share-reward').hidden = true }
  $('close-claim-card').addEventListener('click', hideReward)
  $('share-reward').addEventListener('cancel', hideReward)
  function renderReward(result, address, openPopup = false) {
    const allocation = result.allocation
    $('share-reward').hidden = true
    if (!allocation || allocation.status !== 'claimed' || !/^0x[0-9a-fA-F]{64}$/.test(allocation.claimTx || '') || !matchedHandle) return
    const amount = allocation.amountHunch
    const displayAmount = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const canvas = $('reward-card'), ctx = canvas.getContext('2d')
    const box = (x,y,w,h,fill) => { ctx.fillStyle='#171713';ctx.fillRect(x+7,y+7,w,h);ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);ctx.strokeStyle='#171713';ctx.lineWidth=4;ctx.strokeRect(x,y,w,h) }
    ctx.fillStyle='#f4f0df';ctx.fillRect(0,0,1200,675)
    ctx.fillStyle='#ded8bd';for(let x=12;x<1200;x+=22)for(let y=12;y<675;y+=22){ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill()}
    ctx.strokeStyle='#171713';ctx.lineWidth=8;ctx.strokeRect(17,17,1166,641)
    ctx.fillStyle='#171713';ctx.font='900 49px Arial';ctx.fillText('hunch',54,91)
    box(831,44,306,53,'#cbff70');ctx.fillStyle='#171713';ctx.font='bold 20px Arial';ctx.fillText('ON-CHAIN CONFIRMED',852,78)
    ctx.fillStyle='#171713';ctx.font='bold 21px Arial';ctx.fillText('@'+matchedHandle,56,157)
    ctx.font='900 64px Arial';ctx.fillText('EARLY SUPPORT. PAID.',56,230)
    box(54,267,1084,179,'#ff754a');ctx.fillStyle='#171713';ctx.font='bold 20px Arial';ctx.fillText('CLAIMED REWARD',80,303)
    ctx.font='900 86px Arial';ctx.fillText(displayAmount,78,398,807)
    ctx.font='bold 39px Arial';ctx.fillText('$HUNCH',938,394)
    box(54,475,521,76,'#fffdf5');box(599,475,539,76,'#fffdf5')
    ctx.fillStyle='#64624f';ctx.font='bold 14px Arial';ctx.fillText('RECEIVING WALLET',76,501);ctx.fillText('NETWORK',621,501)
    ctx.fillStyle='#171713';ctx.font='bold 25px Arial';ctx.fillText(address.slice(0,6)+'…'+address.slice(-4),76,534);ctx.fillText('Robinhood Chain',621,534)
    ctx.font='17px Arial';ctx.fillText('TX '+allocation.claimTx.slice(0,12)+'…'+allocation.claimTx.slice(-8),56,603)
    ctx.font='bold 18px Arial';ctx.fillText('@hunchmode · @_ValeriusX',814,604)
    $('share-title').textContent='Your $HUNCH claim card'
    $('share-description').textContent='Confirmed on chain. Download your card and share it on X.'
    const text='I claimed '+displayAmount+' $HUNCH for supporting @hunchmode early.\n\nFree hunches. Paid proof. Built on @orbiodotso.'
    $('share-on-x').href='https://twitter.com/intent/tweet?text='+encodeURIComponent(text)+'&url='+encodeURIComponent(location.origin+'/airdrop')
    $('claim-receipt').hidden=false
    $('claim-receipt').href='https://robinhoodchain.blockscout.com/tx/'+allocation.claimTx
    if (openPopup) { $('share-reward').hidden=false; if (!$('share-reward').open) $('share-reward').showModal() }
  }
  $('download-card').addEventListener('click', () => {
    if ($('share-reward').hidden) return
    $('reward-card').toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = 'hunch-supporter-card.png'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  })
  const api = async (url, body) => {
    const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Request failed. Try again.')
    return json
  }
  const walletMessage = text => { $('wallet-picker-status').textContent = text; $('wallet-state').textContent = text }
  function walletError(e) {
    if (e.code === 4001) return 'Connection cancelled in your wallet. Choose the wallet again when ready.'
    if (e.code === -32002) return 'A connection request is already waiting. Open your wallet extension and approve or cancel it.'
    if (e.code === 4100) return 'Your wallet has not authorized this site. Unlock it and approve the connection.'
    return e.message || 'Could not connect. Unlock your wallet and try again.'
  }
  async function connect(selected, name) {
    if (busy || connecting) return
    connecting = true
    $('connect-wallet').disabled = true
    walletMessage(`Waiting for ${name}… Unlock your wallet and approve the connection request.`)
    try {
      let timer
      const accounts = await Promise.race([
        selected.request({ method: 'eth_requestAccounts' }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Still waiting for your wallet. Open the extension or wallet app to approve the request, then try again.')), 45000) }),
      ]).finally(() => clearTimeout(timer))
      if (!Array.isArray(accounts) || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0] || '')) throw new Error('Select an Ethereum-compatible wallet account to continue.')
      if (provider?.removeListener) { provider.removeListener('accountsChanged', accountsChanged); provider.removeListener('disconnect', reset) }
      provider = selected
      if (provider.on) { provider.on('accountsChanged', accountsChanged); provider.on('disconnect', reset) }
      wallet = accounts[0]; matchedHandle = null; claimState = null; accountVersion++
      const expected = wallet, version = accountVersion
      $('share-reward').hidden = true
      $('wallet-state').textContent = `Connected: ${wallet}`
      const result = await api(`/api/airdrop/wallet/${encodeURIComponent(wallet)}`)
      if (version !== accountVersion) return
      eligible = result.eligible === true
      $('submit-entry').disabled = !!result.submission
      $('airdrop-form').hidden = !!result.submission
      const messages = { pending: 'Your submission is pending review. Claims are coming soon.', approved: 'Your allocation is approved. Claims are coming soon.', rejected: 'Your submission was not approved. Contact @hunchmode if you need a review.', claimed: 'Your HUNCH payout is confirmed.' }
      status(result.submission ? messages[result.submission.status] || 'Your submission is under review.' : 'Wallet connected. Add your existing posts below.')
      renderReward(result, expected)
      renderClaim(result)
      $('connect-wallet').textContent = `Connected · ${wallet.slice(0, 6)}…${wallet.slice(-4)}`
      $('wallet-picker').close()
      if (!eligible) {
        $('claim-reward').disabled = true
        $('claim-amount').textContent = 'This wallet is not eligible for this airdrop.'
        status('Not eligible. Connect the same wallet you registered for an approved reward.')
        $('not-eligible-wallet').textContent = `${expected.slice(0, 6)}…${expected.slice(-4)}`
        $('not-eligible').showModal()
      }
    } catch (e) { wallet = null; accountVersion++; $('submit-entry').disabled = true; walletMessage(walletError(e)) }
    finally { connecting = false; $('connect-wallet').disabled = false }
  }
  function choices() {
    const options = [...discovered.values()]
    const legacy = Array.isArray(window.ethereum?.providers) ? window.ethereum.providers : window.ethereum ? [window.ethereum] : []
    for (const p of legacy) {
      if (typeof p?.request !== 'function' || options.some(option => option.provider === p)) continue
      options.push({provider: p, info: {name: p.isMetaMask ? 'MetaMask' : p.isTrust ? 'Trust Wallet' : p.isCoinbaseWallet ? 'Coinbase Wallet' : 'Browser wallet'}})
    }
    $('wallet-options').replaceChildren()
    for (const option of options) {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'wallet-option'; button.textContent = option.info.name
      button.addEventListener('click', () => connect(option.provider, option.info.name))
      $('wallet-options').append(button)
    }
    $('wallet-picker-help').textContent = options.length ? 'Choose your wallet. Approve the request in its popup or app.' : 'No wallet extension is detected in this browser. Use one of the options below.'
  }
  window.addEventListener('eip6963:announceProvider', e => {
    const detail = e.detail
    if (!detail?.provider || typeof detail.provider.request !== 'function' || typeof detail.info?.uuid !== 'string' || typeof detail.info?.name !== 'string') return
    discovered.set(detail.info.uuid, {provider: detail.provider, info: {name: detail.info.name.slice(0, 80)}})
    if ($('wallet-picker').open && !connecting) choices()
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  window.addEventListener('ethereum#initialized', choices)
  $('connect-wallet').addEventListener('click', () => {
    if (busy || connecting) return
    $('wallet-picker-status').textContent = ''
    $('wallet-picker').showModal()
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    choices()
  })
  $('wallet-close').addEventListener('click', () => $('wallet-picker').close())
  $('not-eligible-close').addEventListener('click', () => $('not-eligible').close())
  $('not-eligible-change').addEventListener('click', () => { $('not-eligible').close(); $('connect-wallet').click() })
  $('wallet-picker').addEventListener('click', e => { if (e.target === $('wallet-picker')) { const r=e.target.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close() } })
  const pageUrl = location.origin + '/airdrop'
  function renderClaim(result) {
    claimsOpen = result.campaign.claimsOpen
    $('claim-state').textContent=claimsOpen ? 'Claims open' : 'Preparing'
    $('claim-state-detail').textContent=claimsOpen ? 'Your reward is ready' : 'Waiting for full pool funding'
    const allocation=result.allocation
    if(allocation && wallet) claimState=allocation.status
    $('claim-panel').hidden=false
    $('claim-reward').disabled=!!wallet && eligible===false
    $('claim-note').textContent='Sign your fixed reward request. No wallet payment or token approval. The treasury covers gas.'
    if(allocation){
      $('claim-amount').textContent=allocation.amountHunch+' $HUNCH'
      $('claim-reward').textContent=allocation.status==='claimed' ? 'View claim card' : allocation.status==='processing' ? 'Check claim' : 'Claim $HUNCH'
      status(allocation.status==='claimed' ? 'Reward claimed. Enter the matching X handle to view your card.' : allocation.status==='processing' ? 'Your payout is awaiting confirmation. Use Check claim to resume safely.' : claimsOpen ? 'Your reward is ready. Enter your registered X handle.' : 'Your reward is allocated. Waiting for the full reward pool to be funded.')
    }
  }
  api('/api/airdrop').then(campaign=>renderClaim({campaign,allocation:null})).catch(()=>{})
  async function matchPair() {
    if(!wallet || eligible!==true) throw new Error('Connect your eligible registered wallet.')
    const expected=wallet,version=accountVersion,handle=$('claim-handle').value.trim()
    if(!/^@?[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('Enter your registered X handle.')
    const result=await api('/api/airdrop/claim-match',{wallet:expected,handle})
    if(version!==accountVersion || handle!==$('claim-handle').value.trim()) throw new Error('Wallet or X handle changed. Check again.')
    matchedHandle=result.handle
    $('claim-handle-status').textContent='Wallet and @'+matchedHandle+' match.'
    renderReward(result,expected)
    return result
  }
  $('claim-handle').addEventListener('input',()=>{matchedHandle=null;hideReward();$('claim-handle-status').textContent=''})
  $('claim-handle').addEventListener('blur',async()=>{if(!wallet || eligible!==true || !$('claim-handle').value.trim())return;try{await matchPair()}catch(error){$('claim-handle-status').textContent=error.message}})
  $('claim-reward').addEventListener('click',async()=>{
    if(busy)return
    if(wallet && eligible===false){$('not-eligible').showModal();return}
    if(!wallet || !provider){$('connect-wallet').click();return}
    const expected=wallet,version=accountVersion
    busy=true;$('claim-reward').disabled=true
    try{
      const pair=await matchPair()
      if(pair.allocation.status==='claimed'){renderReward(pair,expected,true);status('Your reward is confirmed. Download or share your card.');return}
      if(!claimsOpen)throw new Error('Claims open after the full reward pool is funded. Your allocation is reserved.')
      if(!$('claim-follows').checked)throw new Error('Follow @hunchmode and @_ValeriusX, then tick the declaration.')
      status('Preparing your fixed reward claim…')
      const challenge=await api('/api/airdrop/claim-challenge',{wallet:expected,handle:matchedHandle,follows:true})
      if(version!==accountVersion)throw new Error('Wallet changed. Reconnect your registered wallet.')
      const messageHex='0x'+Array.from(new TextEncoder().encode(challenge.message)).map(byte=>byte.toString(16).padStart(2,'0')).join('')
      status('Sign your reward request in your wallet. No payment or token approval is required.')
      const signature=await provider.request({method:'personal_sign',params:[messageHex,expected]})
      if(version!==accountVersion)throw new Error('Wallet changed. Reconnect your registered wallet.')
      status('Sending $HUNCH. Waiting for chain confirmation…')
      let payout=await api('/api/airdrop/claim',{id:challenge.id,signature})
      for(let attempt=0;payout.status==='processing' && attempt<6 && version===accountVersion;attempt++){
        status('Your payout is processing. Your card will open automatically after confirmation…')
        await new Promise(resolve=>setTimeout(resolve,10000))
        if(version!==accountVersion)return
        payout=await api('/api/airdrop/claim',{id:challenge.id,signature})
      }
      if(version===accountVersion && payout.status==='claimed')renderReward(payout,expected,true)
      if(version!==accountVersion)return
      const result=await api('/api/airdrop/wallet/'+encodeURIComponent(expected))
      if(version!==accountVersion)return
      renderClaim(result);if(payout.status!=='claimed' || !payout.allocation)renderReward(result,expected,payout.status==='claimed')
      status(payout.status==='claimed' ? 'Your $HUNCH is confirmed. Download or share your claim card.' : payout.message)
    }catch(error){if(version===accountVersion){status(error.code===4001 ? 'Signature cancelled. No new payout requested.' : error.code===-32002 ? 'A signature request is waiting in your wallet.' : error.message);$('claim-handle-status').textContent=matchedHandle ? 'Wallet and @'+matchedHandle+' match.' : error.message}}
    finally{busy=false;$('claim-reward').disabled=!!wallet && eligible===false}
  })
  $('open-metamask').href = `https://metamask.app.link/dapp/${location.host}/airdrop`
  $('open-trust').href = `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(pageUrl)}`
  $('copy-wallet-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pageUrl); walletMessage('Page link copied. Open it in Chrome, Edge, or your wallet app’s browser.') }
    catch { walletMessage(`Open this link in a wallet-enabled browser:\n${pageUrl}`) }
  })
  $('airdrop-form').addEventListener('submit', async e => {
    e.preventDefault()
    if (busy) return
    if (!wallet || !provider) { walletMessage('Connect your wallet before submitting.'); $('connect-wallet').scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
    $('handle').value = $('handle').value.trim()
    if (!$('airdrop-form').reportValidity()) return
    busy = true; $('submit-entry').disabled = true
    $('submit-entry').textContent = 'Preparing signature…'
    $('airdrop-status').scrollIntoView({ block: 'center', behavior: 'smooth' })
    const expected = wallet; const version = accountVersion
    try {
      const handle = $('handle').value.trim()
      const posts = $('posts').value.split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => ({ url }))
      status('Preparing your wallet signature…')
      const challenge = await api('/api/airdrop/challenge', { wallet: expected, handle, posts })
      if (version !== accountVersion) throw new Error('Wallet changed. Please reconnect.')
      const messageHex = '0x' + Array.from(new TextEncoder().encode(challenge.message)).map(byte => byte.toString(16).padStart(2, '0')).join('')
      $('submit-entry').textContent = 'Approve in your wallet…'
      status('Your wallet signature is ready. Open your wallet prompt and approve it. No payment or token approval is requested.')
      const signature = await provider.request({ method: 'personal_sign', params: [messageHex, expected] })
      if (version !== accountVersion) throw new Error('Wallet changed. Please reconnect.')
      $('submit-entry').textContent = 'Saving submission…'
      status('Signature received. Saving your submission…')
      const result = await api('/api/airdrop/submit', { id: challenge.id, signature })
      $('airdrop-form').hidden = true
      status(`Submission received — pending review.\n\nYour confirmation code: ${result.verificationCode}\n\nSave this code. Reply to one of your submitted X posts with this code to prove you control the account. This verification reply does not count toward rewards.\n\nYour allocation will appear after review. Claims are coming soon.`)
    } catch (e) { status(e.code === 4001 ? 'Signature cancelled. No submission was made.' : e.code === -32002 ? 'A signature request is already waiting. Open your wallet and approve or cancel it before trying again.' : e.message || 'Submission failed. Please try again.') }
    finally { busy = false; $('submit-entry').disabled = !wallet; $('submit-entry').textContent = 'Sign & submit for review' }
  })
})()
