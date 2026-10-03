// Exercise the shipped browser scripts with a mocked wallet and API. Never sends a real transaction.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../web/watch.js', import.meta.url), 'utf8')
const wallet = '0x' + '1'.repeat(40)
const other = '0x' + '2'.repeat(40)
const token = '0x' + '3'.repeat(40)
const hunch = '0x' + '4'.repeat(40)
const contract = '0x' + '5'.repeat(40)
const approveHash = '0x' + 'a'.repeat(64)
const fundHash = '0x' + 'b'.repeat(64)
const payment = { ready: true, contract, chainId: 4663, token, tokenSymbol: 'USDG', decimals: 6, minAmount: 2, usdPerUnit: 1, watchIdBytes32: '0x' + 'c'.repeat(64), calls: { fund: '0x123' }, alsoAccepts: [{ token: hunch, symbol: 'HUNCH', decimals: 18, usdPerUnit: 0.00001 }] }
class Element {
  handlers = {}; value = ''; disabled = false; hidden = true; textContent = ''; dataset = {}; _html = ''
  addEventListener(event, handler) { this.handlers[event] = handler }
  scrollIntoView() {}
  set innerHTML(html) { this._html = html; if (html.startsWith('<option')) this.value = html.match(/value="([^"]+)"/)[1] }
  get innerHTML() { return this._html }
}
function dom() {
  const elements = new Map()
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) }
  return { get, document: { getElementById: get, addEventListener() {} } }
}
const storage = values => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) })

async function walletScenario(mode = 'success', saved = new Map()) {
  const { get, document } = dom()
  let chain = ['switch-rejected', 'switch-ignored'].includes(mode) ? '0x1' : '0x1237'
  let current = wallet
  let recovering = false
  let clock = Date.now()
  class ClockDate extends Date { static now() { return clock } }
  const transactions = [], listeners = {}
  const ethereum = {
    on(event, handler) { listeners[event] = handler },
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [current]
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') {
        if (mode === 'switch-rejected') throw { code: 4001 }
        if (mode !== 'switch-ignored') chain = params[0].chainId
        return null
      }
      if (method === 'eth_sendTransaction') {
        transactions.push(params[0])
        return transactions.length === 1 ? approveHash : fundHash
      }
      if (method === 'eth_getTransactionReceipt') {
        if (params[0] === approveHash && mode === 'account-changed') { current = other; listeners.accountsChanged([other]) }
        if (params[0] === approveHash && mode === 'network-changed') { chain = '0x1'; listeners.chainChanged(chain) }
        if (params[0] === fundHash && mode === 'receipt-unavailable' && !recovering) throw new Error('Receipt unavailable')
        if (params[0] === fundHash && mode === 'receipt-hangs' && !recovering) return new Promise(() => {})
        if (params[0] === fundHash && mode === 'confirmation-pending' && !recovering) return null
        return { status: mode === 'approval-reverted' && params[0] === approveHash || mode === 'fund-reverted' && params[0] === fundHash ? '0x0' : '0x1' }
      }
      throw new Error('Unexpected wallet method: ' + method)
    },
  }
  const window = { ethereum }
  const timer = (handler, ms) => {
    if (mode === 'confirmation-pending' && ms === 2000) { clock += 2000; return setTimeout(handler, 0) }
    return setTimeout(handler, ms === 10000 && mode === 'receipt-hangs' ? 0 : ms)
  }
  runInNewContext(source.slice(source.indexOf('// ── paying')), { document, window, Date: ClockDate, localStorage: storage(saved), setTimeout: timer, clearTimeout })
  window.__paySetup(payment)
  const click = () => get('pay-go').handlers.click()
  await click()
  if (!['switch-rejected', 'switch-ignored'].includes(mode)) await click()
  return { get, transactions, window, saved, click, recover: () => { recovering = true } }
}

for (const mode of ['switch-rejected', 'switch-ignored']) {
  const result = await walletScenario(mode)
  assert.equal(result.transactions.length, 0, mode + ' must never send payment')
  assert.ok(result.get('pay-err').textContent)
  assert.equal(result.get('pay-go').disabled, false)
}
for (const mode of ['approval-reverted', 'account-changed', 'network-changed']) {
  const result = await walletScenario(mode)
  assert.equal(result.transactions.length, 1, mode + ' must stop before funding')
  assert.ok(result.get('pay-err').textContent)
}
const failed = await walletScenario('fund-reverted')
assert.equal(failed.transactions.length, 2)
assert.match(failed.get('pay-err').textContent, /failed on chain/)
assert.doesNotMatch(failed.get('pay-status').innerHTML, /Payment confirmed/)

for (const mode of ['receipt-unavailable', 'receipt-hangs', 'confirmation-pending']) {
  const result = await walletScenario(mode)
  assert.equal(result.transactions.length, 2)
  assert.equal(result.get('pay-go').textContent, 'Check transaction')
  result.recover()
  await result.click(); await result.click()
  assert.equal(result.transactions.length, 2, 'recovery must only read the existing receipt')
  assert.match(result.get('pay-status').innerHTML, /Payment confirmed on chain/)
  const reloaded = await walletScenario('success', result.saved)
  assert.equal(reloaded.transactions.length, 0, 'reload must recover the saved payment without another transfer')
}
const success = await walletScenario()
assert.equal(success.transactions.length, 2)
assert.equal(success.transactions[1].to, contract)
assert.equal(success.transactions[1].data.slice(-64), (2000000n).toString(16).padStart(64, '0'))
assert.match(success.get('pay-status').innerHTML, /Hunch is verifying credit/)
// A fresh pending watch lets us test exact input and preservation before any transfer.
const { get, document } = dom()
let sends = 0
const window = { ethereum: { on() {}, async request({ method }) {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet]
  if (method === 'eth_chainId') return '0x1237'
  if (method === 'eth_sendTransaction') { sends++; return approveHash }
  return { status: '0x1' }
} } }
runInNewContext(source.slice(source.indexOf('// ── paying')), { document, window, localStorage: storage(new Map()), setTimeout, clearTimeout })
window.__paySetup(payment)
await get('pay-go').handlers.click()
for (const invalid of ['2.0000001', '1.2.3', '-1', '0', '1e6']) {
  get('pay-amount').value = invalid
  await get('pay-go').handlers.click()
  assert.equal(sends, 0, 'invalid amount ' + invalid + ' must not reach the wallet')
}
get('pay-token').value = hunch; get('pay-amount').value = '123456.123456789123456789'
window.__paySetup({ ...payment, usdPerUnit: 1.01 })
assert.equal(get('pay-token').value, hunch)
assert.equal(get('pay-amount').value, '123456.123456789123456789')

// Full workspace: rendering must retain lifecycle status and escape user-supplied content.
const workspace = dom(), tasks = new Map()
let taskId = 0
const body = { watch: { id: 'wat_12345678', entity: '<img src=x onerror=alert(1)>', status: 'active', terms: ['acme'], payments: [], budget: { budgetUsd: 2, spentUsd: 0.02, remaining: 1.98, available: 0.3, reserve: 0.4 } }, payment, monitoring: { paused: false, lastScanAt: '2026-10-03T08:00:00Z' }, searchedUsd: 0.01, seen: [{ action: 'INVESTIGATE', score: 0.8, claim: '<script>oops()</script>', mentions: 2, sources: ['<svg>'], at: '2026-10-03T08:00:00Z', reason: 'checking', links: ['javascript:alert(1)'], investigationId: 'inv_123456' }], investigations: [{ id: 'inv_123456', claim: 'Claim', state: 'rejected', status: 'supported', accepted: false, spentUsd: 0.02, confidence: 0.99, at: '2026-10-03T08:00:00Z' }] }
runInNewContext(source, { document: workspace.document, window: {}, URLSearchParams, AbortController, location: { search: '?id=wat_12345678', origin: 'https://example.com' }, history: {}, navigator: {}, localStorage: storage(new Map()), fetch: async () => ({ ok: true, json: async () => body }), setTimeout: (fn, ms) => { tasks.set(++taskId, { fn, ms }); return taskId }, clearTimeout: id => tasks.delete(id) })
await new Promise(resolve => setImmediate(resolve))
assert.equal(workspace.get('watch-setup').hidden, true)
assert.equal(workspace.get('watch-workspace').hidden, false)
assert.equal(workspace.get('pay').hidden, true)
assert.match(workspace.get('st-seen').innerHTML, /&lt;script&gt;/)
assert.doesNotMatch(workspace.get('st-seen').innerHTML, /href="javascript:|<svg>/)
assert.match(workspace.get('st-invs').innerHTML, /Verification needs review/)
assert.doesNotMatch(workspace.get('st-invs').innerHTML, /99% confidence|Supported/)
assert.match(workspace.get('st-invs').innerHTML, /href="\/investigations\/inv_123456"/)
assert.match(workspace.get('st-stats').innerHTML, /Budget remaining.*Ready for next investigation/s)
assert.ok([...tasks.values()].some(task => task.ms === 6000))

// The report poller preserves open reasoning and stops auto-refresh after research finishes.
const reportDom = dom(), reportTasks = new Map()
const root = reportDom.get('investigation-report')
root.dataset = { id: 'inv_123456', running: 'true' }; root.innerHTML = 'Old report'
const detail = { dataset: { reportDetail: 'reasoning' }, open: true }
root.querySelectorAll = () => [detail]
let reportReads = 0
runInNewContext(readFileSync(new URL('../web/investigation-report.js', import.meta.url), 'utf8'), { document: reportDom.document, AbortController, fetch: async () => { reportReads++; return { ok: true, json: async () => ({ html: 'Finished report', running: false }) } }, setTimeout: (fn, ms) => { reportTasks.set(++taskId, { fn, ms }); return taskId }, clearTimeout: id => reportTasks.delete(id) })
await reportDom.get('report-refresh').handlers.click()
assert.equal(root.innerHTML, 'Finished report'); assert.equal(detail.open, true)
assert.equal(reportReads, 1)
assert.equal(reportTasks.size, 0, 'finished report must stop automatic polling')
assert.equal(reportDom.get('report-refresh').disabled, false)
// The independent history browser script reads beyond the console's ten-report snapshot.
const historyDom = dom(), historyCalls = []
let historyReads = 0
runInNewContext(readFileSync(new URL('../web/investigation-list.js', import.meta.url), 'utf8'), { document: historyDom.document, location: { search: '?watch=wat_12345678' }, URLSearchParams, AbortController,
  fetch: async path => {
    historyCalls.push(path); historyReads++
    const offset = Number(new URL('https://example.com' + path).searchParams.get('offset'))
    return { ok: true, json: async () => ({ total: 25, nextOffset: offset === 0 ? 20 : null, items: Array.from({length:offset===0?20:5},(_,i)=>({id:'inv_'+(offset+i),watchId:'wat_12345678',claim: 'Claim '+(offset+i),createdAt:'2026-10-03T08:00:00Z',status:'complete',verdict:'supported',confidence:0.9,accepted:true,spentUsd:0.02})) }) }
  }, setTimeout, clearTimeout })
await new Promise(resolve=>setImmediate(resolve))
assert.match(historyDom.get('reports-update').textContent, /Showing 20 of 25/)
await historyDom.get('investigation').handlers.click({target:{closest:()=>true}})
await new Promise(resolve=>setImmediate(resolve))
assert.match(historyDom.get('reports-update').textContent, /Showing 25 of 25/)
assert.match(historyDom.get('investigation').innerHTML, /Claim 24/)
assert.doesNotMatch(historyDom.get('investigation').innerHTML, /id="reports-more"/)
assert.equal(historyReads, 2)
assert.match(historyCalls[1], /offset=20.*watch=wat_12345678/)
console.log('PASS: watch workspace, exact token amounts, chain/account safeguards, reverted transactions, receipt timeouts, duplicate-payment prevention, reload recovery, report polling and safe rendering')
