// Exercise the real browser script without a wallet, server, or live entry.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const source = readFileSync(new URL('../web/airdrop.js', import.meta.url), 'utf8')
const wallet = '0x1234567890123456789012345678901234567890'

async function scenario(mode) {
  class Element {
    handlers = {}; children = []; value = ''; hidden = false; disabled = false; textContent = ''; open = false
    addEventListener(name, fn) { this.handlers[name] = fn }
    replaceChildren() { this.children = [] }
    append(child) { this.children.push(child) }
    showModal() { this.open = true }
    close() { this.open = false }
    scrollIntoView() {}
    reportValidity() { return true }
  }
  const elements = new Map()
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) }
  let onAccountsChanged
  let submissions = 0
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
    if (path === '/api/airdrop') return { claimsOpen: false }
    if (path.includes('/wallet/')) return { campaign: { claimsOpen: false }, submission: null, allocation: null }
    if (path.endsWith('/challenge')) return { id: 'test', message: 'Test ownership' }
    if (path.endsWith('/submit')) { submissions++; return { verificationCode: 'HUNCH-TEST' } }
    throw Error('Unexpected endpoint')
  } })
  runInNewContext(source, { window, document, fetch, Event, TextEncoder, URL, navigator: {}, location: { origin: 'https://hunch.example', host: 'hunch.example' }, setTimeout, clearTimeout })
  get('connect-wallet').handlers.click()
  await get('wallet-options').children[0].handlers.click()
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
}
for (const mode of ['same', 'changed', 'cancelled', 'pending']) await scenario(mode)
console.log('Wallet submission regression checks passed: same-account resume, real account change, cancellation and pending signature.')
