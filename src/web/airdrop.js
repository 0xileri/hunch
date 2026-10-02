(() => {
  const $ = id => document.getElementById(id)
  let wallet = null
  let busy = false
  let accountVersion = 0
  const status = text => { $('airdrop-status').textContent = text }
  const reset = () => { wallet = null; accountVersion++; $('submit-entry').disabled = true; $('wallet-state').textContent = 'Wallet changed. Connect again to continue.'; status('') }
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
      $('wallet-state').textContent = `Connected: ${wallet}`
      const result = await api(`/api/airdrop/wallet/${encodeURIComponent(wallet)}`)
      $('submit-entry').disabled = !!result.submission
      status(result.submission ? 'Your submission is pending review. Claims are not open yet.' : 'Wallet connected. Add your existing posts below.')
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
