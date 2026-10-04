// Read-only directory checks. No live server, wallet or watch is created.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { watchCategory } from '../web/watch-directory.ts'

assert.equal(watchCategory({ house: true, terms: ['project x'] }), 'demo')
assert.equal(watchCategory({ house: false, terms: ['zzsmoketestentity'] }), 'test')
assert.equal(watchCategory({ house: false, terms: ['zzratecheckentity'] }), 'test')
assert.equal(watchCategory({ house: false, terms: ['zzlegitimateproject'] }), 'project')
assert.equal(watchCategory({ house: false, terms: ['$hunch'] }), 'project')

class Element {
  handlers = {}; dataset = {}; value = ''; textContent = ''; innerHTML = ''; disabled = false; hidden = false; attributes = {}
  addEventListener(name, fn) { this.handlers[name] = fn }
  setAttribute(name, value) { this.attributes[name] = value }
  querySelector() { return this.count ??= new Element() }
  scrollIntoView() {}
}
const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) }
const filters = ['active','pending','demo','all'].map(key => { const element = new Element(); element.dataset.watchFilter = key; return element })
const row = (id, status, amount, category = 'project', entity = id) => ({ id, entity, status, category, terms: ['term-'+id], investigations: 2, createdAt: '2026-10-03T00:00:00Z', expiresAt: null, budget: {budgetUsd:amount,remaining:amount-0.1,spentUsd:0.1} })
const watches = [row('funded','active',1), row('expired','active',2), ...Array.from({length:4},(_,i)=>row('pending-'+i,'pending',0)), ...Array.from({length:7},(_,i)=>row('test-'+i,'active',1,'test'))]
watches[1].expiresAt = '2020-01-01T00:00:00Z'
watches[2].entity = '<img src=x onerror=alert(1)>'
let reads = 0, url = ''
runInNewContext(readFileSync(new URL('../web/watch-list.js', import.meta.url), 'utf8'), {
  document: {getElementById:get,querySelectorAll:()=>filters}, location:{search:''}, history:{replaceState(_a,_b,path){url=path}}, URLSearchParams, AbortController,
  fetch:async(path,options)=>{assert.equal(path,'/api/watches');assert.equal(options.cache,'no-store');reads++;return{ok:true,json:async()=>watches}},
  setTimeout:()=>1,clearTimeout(){},
})
await new Promise(resolve=>setImmediate(resolve))
assert.match(get('watch-directory-summary').innerHTML, /<strong>1<\/strong> active project/)
assert.match(get('watch-directory-summary').innerHTML, /<strong>4<\/strong> awaiting funding/)
assert.match(get('watch-directory-summary').innerHTML, /<strong>\$3\.00<\/strong> project funding/)
assert.match(get('watch-directory-grid').innerHTML, /funded/)
assert.doesNotMatch(get('watch-directory-grid').innerHTML, /test-0|pending-0|expired/)
assert.equal(filters[0].count.textContent, '1')
assert.equal(filters[1].count.textContent, '4')
assert.equal(filters[2].count.textContent, '7')
assert.equal(filters[3].count.textContent, '13')
filters[1].handlers.click()
assert.match(url, /view=pending/)
assert.match(get('watch-directory-grid').innerHTML, /Awaiting funding/)
assert.match(get('watch-directory-grid').innerHTML, /&lt;img/)
assert.doesNotMatch(get('watch-directory-grid').innerHTML, /<img/)
filters[2].handlers.click()
assert.equal((get('watch-directory-grid').innerHTML.match(/<article /g)||[]).length,6)
assert.equal(get('watch-directory-pagination').hidden,false)
get('watch-directory-next').handlers.click()
assert.equal((get('watch-directory-grid').innerHTML.match(/<article /g)||[]).length,1)
assert.equal(get('watch-directory-next').disabled,true)
get('watch-directory-search').value = 'no-match'
get('watch-directory-search').handlers.input()
assert.match(get('watch-directory-grid').innerHTML,/No matching projects/)
assert.equal(get('watch-directory-pagination').hidden,true)
get('watch-directory-search').value='test-3'
get('watch-directory-search').handlers.input()
assert.match(get('watch-directory-grid').innerHTML,/test-3/)
assert.equal(reads,1,'filters, pagination and search must not submit requests')
console.log('PASS: project/fixture categories, accurate funded and active counts, expiry, safe rendering, filters, search and pagination')
