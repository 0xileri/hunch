// Exercise the real browser script without a wallet, server, or live entry.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const source = readFileSync(new URL('../web/airdrop.js', import.meta.url), 'utf8')
const wallet = '0x1234567890123456789012345678901234567890'

async function scenario(mode, eligible = false, claimsOpen = false, claimMode = 'normal') {
  class Element {
    handlers = {}; children = []; value = ''; hidden = false; disabled = false; textContent = ''; open = false
    addEventListener(name, fn) { this.handlers[name] = fn }
    replaceChildren() { this.children = [] }
    append(child) { this.children.push(child) }
    showModal() { this.open = true }
    close() { this.open = false }
    scrollIntoView() {}
    reportValidity() { return true }
    getContext() { return new Proxy({}, { get: () => () => {} }) }
  }
  const elements = new Map()
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) }
  let onAccountsChanged
  let submissions = 0
  let claimed = false
  let claimRequests = 0
  let walletPolls = 0
  let claiming = false
  const ethereum = {
    async request({ method }) {
      if (method === 'eth_requestAccounts') return [wallet]
      if (method === 'personal_sign') {
        if(claiming && claimMode==='signature-timeout')return new Promise(()=>{})
        if (mode === 'cancelled') throw { code: 4001 }
        if (mode === 'pending') throw { code: -32002 }
        onAccountsChanged(mode === 'changed' ? ['0x9999999999999999999999999999999999999999'] : [wallet.toUpperCase().replace('0X', '0x')])
        return '0x' + '1'.repeat(130)
      }
    },
    on(name, fn) { if (name === 'accountsChanged') onAccountsChanged = fn },
  }
  const document = { getElementById: get, createElement: () => new Element() }
  const window = { ethereum, addEventListener() {}, dispatchEvent() {} }
  const fetch = async (path, options) => {
    if(path.endsWith('/claim') && claimMode==='request-timeout') {
      claimRequests++;claimed=true
      return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Aborted'))))
    }
    if(path.endsWith('/claim') && claimMode === 'lost-response') {
      claimRequests++;claimed=true
      throw new TypeError('Connection interrupted after broadcast')
    }
    if(path.endsWith('/claim') && claimMode === 'server-error') return {ok:false,json:async()=>({error:'Treasury funding is not yet sufficient.'})}
    return { ok: true, json: async () => {
    const allocation = { status: claimed ? 'claimed' : 'approved', amountHunch: '210000', claimTx: claimed ? '0x' + '1'.repeat(64) : null }
    if (path === '/api/airdrop') return { claimsOpen }
    if (path.includes('/wallet/')) {
      if(claimRequests && claimMode === 'processing') {walletPolls++;if(walletPolls>=2)claimed=true}
      const current={...allocation,status:claimed?'claimed':claimRequests?'processing':'approved',claimTx:claimed?'0x'+'1'.repeat(64):null,transactionHash:claimRequests?'0x'+'1'.repeat(64):null}
      return { eligible, campaign: { claimsOpen }, submission: null, allocation: eligible ? current : null }
    }
    if (path.endsWith('/claim-match')) return { matches: true, handle: 'earlybacker', allocation }
    if (path.endsWith('/claim-challenge')) return { id: 'claim', message: 'Test fixed reward' }
    if (path.endsWith('/claim')) { claimRequests++;claimed=!['processing','still-processing'].includes(claimMode);return { status: claimed?'claimed':'processing', allocation: { ...allocation, status: claimed?'claimed':'processing', claimTx: claimed?'0x'+'1'.repeat(64):null,transactionHash:'0x'+'1'.repeat(64) } } }
    if (path.endsWith('/challenge')) return { id: 'test', message: 'Test ownership' }
    if (path.endsWith('/submit')) { submissions++; return { verificationCode: 'HUNCH-TEST' } }
    throw Error('Unexpected endpoint')
  } } }
  const testTimeout=(fn,ms)=>setTimeout(fn,ms===5000 || ms===25000 && claimMode==='request-timeout' || ms===60000 && claimMode==='signature-timeout' ? 0 : ms)
  runInNewContext(source, { window, document, fetch, Event, TextEncoder, URL, AbortController, navigator: {}, location: { origin: 'https://hunch.example', host: 'hunch.example' }, setTimeout:testTimeout, clearTimeout })
  get('connect-wallet').handlers.click()
  await get('wallet-options').children[0].handlers.click()
  assert.equal(get('not-eligible').open, !eligible)
  assert.equal(get('claim-reward').disabled, !eligible)
  if (!eligible) assert.match(get('airdrop-status').textContent, /Not eligible/)
  get('handle').value = ' earlybacker '
  get('posts').value = 'https://x.com/earlybacker/status/123'
  await get('airdrop-form').handlers.submit({ preventDefault() {} })
  assert.equal(get('submit-entry').textContent, 'Sign & submit for review')
  if (mode === 'same') {
    assert.equal(submissions, 1)
    assert.match(get('airdrop-status').textContent, /Submission received/)
    assert.equal(get('handle').value, 'earlybacker')
  } else {
    assert.equal(submissions, 0)
    assert.match(get('airdrop-status').textContent, mode === 'changed' ? /Wallet changed/ : mode === 'cancelled' ? /cancelled/ : /already waiting/)
    assert.equal(get('submit-entry').disabled, mode === 'changed')
  }
  if (claimsOpen) {
    get('claim-handle').value = '@earlybacker'
    get('claim-follows').checked = true
    claiming=true
    await get('claim-reward').handlers.click()
    if(claimMode==='server-error') {
      assert.match(get('airdrop-status').textContent,/funding/)
      assert.equal(get('claim-reward').disabled,false)
      assert.equal(get('share-reward').open,false)
      return
    }
    if(claimMode==='signature-timeout' || claimMode==='still-processing') {
      assert.match(get('airdrop-status').textContent,claimMode==='signature-timeout' ? /waiting for your wallet signature/ : /longer than usual/)
      assert.equal(get('claim-reward').disabled,false)
      assert.equal(get('claim-handle').disabled,false)
      assert.equal(get('share-reward').open,false)
      assert.equal(claimRequests,claimMode==='signature-timeout'?0:1)
      if(claimMode==='still-processing')assert.equal(get('claim-reward').textContent,'Check claim')
      return
    }
    assert.equal(claimed, true)
    assert.equal(get('share-reward').open, true)
    assert.equal(get('share-reward').hidden, false)
    assert.equal(claimRequests,1,'Confirmation polling must not repeat the payout request')
    assert.equal(get('claim-reward').disabled,false)
    assert.equal(get('claim-reward').textContent,'View claim card')
    get('close-claim-card').handlers.click()
    assert.equal(get('share-reward').open, false)
    assert.equal(get('share-reward').hidden, true)
  }
}
for (const mode of ['same', 'changed', 'cancelled', 'pending']) await scenario(mode)
await scenario('same', true)
await scenario('same', true, true)
await scenario('same', true, true, 'processing')
await scenario('same', true, true, 'lost-response')
await scenario('same', true, true, 'server-error')
await scenario('same', true, true, 'request-timeout')
await scenario('same', true, true, 'signature-timeout')
await scenario('same', true, true, 'still-processing')
console.log('Wallet checks passed: bounded request/wallet/confirmation waits, lost-response recovery without duplicate payouts, server errors and confirmed popup.')
