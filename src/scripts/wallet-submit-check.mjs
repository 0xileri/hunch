// Exercise the real browser script without a wallet, server, or live entry.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const source = readFileSync(new URL('../web/airdrop.js', import.meta.url), 'utf8')
const wallet = '0x1234567890123456789012345678901234567890'

async function scenario(mode, eligible = false, claimsOpen = false) {
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
  const ethereum = {
    async request({ method }) {
      if (method === 'eth_requestAccounts') return [wallet]
      if (method === 'personal_sign') {
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
  const fetch = async path => ({ ok: true, json: async () => {
    const allocation = { status: claimed ? 'claimed' : 'approved', amountHunch: '210000', claimTx: claimed ? '0x' + '1'.repeat(64) : null }
    if (path === '/api/airdrop') return { claimsOpen }
    if (path.includes('/wallet/')) return { eligible, campaign: { claimsOpen }, submission: null, allocation: eligible ? allocation : null }
    if (path.endsWith('/claim-match')) return { matches: true, handle: 'earlybacker', allocation }
    if (path.endsWith('/claim-challenge')) return { id: 'claim', message: 'Test fixed reward' }
    if (path.endsWith('/claim')) { claimed = true; return { status: 'claimed', allocation: { ...allocation, status: 'claimed', claimTx: '0x' + '1'.repeat(64) } } }
    if (path.endsWith('/challenge')) return { id: 'test', message: 'Test ownership' }
    if (path.endsWith('/submit')) { submissions++; return { verificationCode: 'HUNCH-TEST' } }
    throw Error('Unexpected endpoint')
  } })
  runInNewContext(source, { window, document, fetch, Event, TextEncoder, URL, navigator: {}, location: { origin: 'https://hunch.example', host: 'hunch.example' }, setTimeout, clearTimeout })
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
    await get('claim-reward').handlers.click()
    assert.equal(claimed, true)
    assert.equal(get('share-reward').open, true)
    assert.equal(get('share-reward').hidden, false)
    get('close-claim-card').handlers.click()
    assert.equal(get('share-reward').open, false)
    assert.equal(get('share-reward').hidden, true)
  }
}
for (const mode of ['same', 'changed', 'cancelled', 'pending']) await scenario(mode)
await scenario('same', true)
await scenario('same', true, true)
console.log('Wallet checks passed: eligibility, account/signature handling, and automatic confirmed claim-card popup with close control.')
