(() => {
  const $ = id => document.getElementById(id)
  let wallet = null
  let busy = false
  let accountVersion = 0
  const status = text => { $('airdrop-status').textContent = text }
  const reset = () => { wallet = null; accountVersion++; $('submit-entry').disabled = true; $('share-reward').hidden = true; $('wallet-state').textContent = 'Wallet changed. Connect again to continue.'; status('') }
  function renderReward(result, address) {
    const allocation = result.allocation
    $('share-reward').hidden = true
    if (!allocation || !['approved', 'claimed'].includes(allocation.status)) return
    const claimed = allocation.status === 'claimed' && /^0x[0-9a-fA-F]{64}$/.test(allocation.claimTx || '')
    const headline = claimed ? 'I claimed $HUNCH.' : 'Approved for $HUNCH.'
    const amount = allocation.amountHunch
    const canvas = $('reward-card'), ctx = canvas.getContext('2d')
    ctx.fillStyle = '#faf8f2'; ctx.fillRect(0, 0, 1200, 675)
    ctx.fillStyle = '#cfcabd'; ctx.beginPath(); ctx.arc(67, 91, 8, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#9a968b'; ctx.beginPath(); ctx.arc(92, 75, 12, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#d9480f'; ctx.beginPath(); ctx.arc(126, 50, 18, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#1a1915'; ctx.font = 'bold 50px Arial'; ctx.fillText('hunch', 168, 88)
    ctx.fillStyle = '#d9480f'; ctx.font = 'bold 19px Arial'; ctx.fillText('EARLY SUPPORTER AIRDROP', 64, 170)
    ctx.fillStyle = '#1a1915'; ctx.font = 'bold 70px Arial'; ctx.fillText(headline, 64, 275)
    ctx.fillStyle = '#d9480f'; ctx.font = 'bold 76px Arial'; ctx.fillText(`${amount} $HUNCH`, 64, 385, 1070)
    ctx.fillStyle = '#5d5a51'; ctx.font = '26px Arial'; ctx.fillText(claimed ? 'Recognized for backing Hunch from the beginning.' : 'My early support has been verified. Claim pending.', 64, 450)
    ctx.font = '22px Arial'; ctx.fillText(`${address.slice(0, 6)}…${address.slice(-4)} · Robinhood Chain`, 64, 500)
    ctx.strokeStyle = '#d9d5cc'; ctx.beginPath(); ctx.moveTo(64, 561); ctx.lineTo(1136, 561); ctx.stroke()
    ctx.font = '22px Arial'; ctx.fillText('Free hunches. Paid proof.', 64, 615); ctx.fillText('@hunchmode', 970, 615)
    $('share-title').textContent = claimed ? 'Your $HUNCH claim card' : 'Your supporter approval card'
    $('share-description').textContent = claimed ? 'Your payout is confirmed. Download your card and share it on X.' : 'Your allocation is approved. This card shows approval; your tokens have not been claimed yet.'
    const text = claimed ? `I claimed ${amount} $HUNCH for supporting @hunchmode early.\n\nBuilt on @orbiodotso. Free hunches. Paid proof.` : `My early support for @hunchmode has been recognized with an approved allocation of ${amount} $HUNCH. Claim pending.\n\nBuilt on @orbiodotso.`
    $('share-on-x').href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin + '/airdrop')}`
    $('claim-receipt').hidden = !claimed
    if (claimed) $('claim-receipt').href = `https://robinhoodchain.blockscout.com/tx/${allocation.claimTx}`
    $('share-reward').hidden = false
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
  if (window.ethereum?.on) window.ethereum.on('accountsChanged', reset)
  $('connect-wallet').addEventListener('click', async () => {
    if (busy) return
    try {
      if (!window.ethereum) throw new Error('No browser wallet detected. Open this page inside your wallet browser or install a browser wallet.')
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      if (!accounts[0]) throw new Error('Select a wallet to continue.')
      wallet = accounts[0]; accountVersion++
      const expected = wallet, version = accountVersion
      $('share-reward').hidden = true
      $('wallet-state').textContent = `Connected: ${wallet}`
      const result = await api(`/api/airdrop/wallet/${encodeURIComponent(wallet)}`)
      if (version !== accountVersion) return
      $('submit-entry').disabled = !!result.submission
      const messages = { pending: 'Your submission is pending review. Claims are not open yet.', approved: 'Your allocation is approved. Claims are not open yet.', rejected: 'Your submission was not approved. Contact @hunchmode if you need a review.', claimed: 'Your HUNCH payout is confirmed.' }
      status(result.submission ? messages[result.submission.status] || 'Your submission is under review.' : 'Wallet connected. Add your existing posts below.')
      renderReward(result, expected)
    } catch (e) { status(e.message || 'Wallet connection was cancelled.') }
  })
  $('airdrop-form').addEventListener('submit', async e => {
    e.preventDefault()
    if (!wallet || busy || !$('airdrop-form').reportValidity()) return
    busy = true; $('submit-entry').disabled = true
    const expected = wallet; const version = accountVersion
    try {
      const handle = $('handle').value.trim()
      const posts = $('posts').value.split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => ({ url }))
      status('Preparing your wallet signature…')
      const challenge = await api('/api/airdrop/challenge', { wallet: expected, handle, posts })
      if (version !== accountVersion) throw new Error('Wallet changed. Please reconnect.')
      const messageHex = '0x' + Array.from(new TextEncoder().encode(challenge.message)).map(byte => byte.toString(16).padStart(2, '0')).join('')
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [messageHex, expected] })
      if (version !== accountVersion) throw new Error('Wallet changed. Please reconnect.')
      const result = await api('/api/airdrop/submit', { id: challenge.id, signature })
      $('airdrop-form').hidden = true
      status(`Submission received — pending review.\n\nYour confirmation code: ${result.verificationCode}\n\nSave this code. Reply to one of your submitted X posts with this code to prove you control the account. This verification reply does not count toward rewards.\n\nYour allocation will appear after review. Claims are not open yet.`)
    } catch (e) { status(e.code === 4001 ? 'Signature cancelled. No submission was made.' : e.message || 'Submission failed. Please try again.') }
    finally { busy = false; $('submit-entry').disabled = !wallet }
  })
})()
