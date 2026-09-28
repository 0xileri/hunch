// The watch layer, offline: intake rules, routing by terms, payment crediting and the budget
// maths. No key, no chain, no spend — it writes to a scratch DATA_DIR, not the agent's state.
process.env.DATA_DIR ??= new URL('../../.watch-check', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
import '../env.js'
import { WATCH } from '../config.js'
import { state } from '../core/state.js'
import { budgetOf, createWatch, HOUSE_ID, houseWatch, matchWatch, watchById, WatchError, watches } from '../core/watches.js'
import { applyPayment, bytes32ToWatchId, watchIdToBytes32 } from '../chain/payments.js'
import type { WatchPayment } from '../core/types.js'

let failures = 0
const ok = (name: string, condition: boolean, detail = '') => {
  if (!condition) failures++
  console.log(`${condition ? ' ok ' : 'FAIL'}  ${name}${detail ? ` · ${detail}` : ''}`)
}
const refuses = (name: string, run: () => unknown) => {
  try {
    run()
    ok(name, false, 'it was allowed')
  } catch (err) {
    ok(name, err instanceof WatchError, err instanceof Error ? err.message : String(err))
  }
}

state.watches = []
const house = houseWatch()
ok('the house watch exists', house.id === HOUSE_ID && house.house)
ok('the house watch spends the operator budget', budgetOf(house).budgetUsd > 0, `$${budgetOf(house).budgetUsd.toFixed(2)}`)

const watch = createWatch({
  entity: 'Acme Protocol',
  terms: ['acme protocol', '$acme'],
  officialUrls: ['https://status.example.com'],
  owner: '0x1111111111111111111111111111111111111111',
})
ok('a new watch starts pending', watch.status === 'pending' && watch.fundedUsd === 0)
ok('a pending watch has no budget', budgetOf(watch).available === 0)
ok('a pending watch is not worked', !matchWatch('Acme Protocol withdrawals are stuck'))

refuses('a term that is too short', () => createWatch({ entity: 'Nope', terms: ['ab'] }))
refuses('a term that matches everything', () => createWatch({ entity: 'Nope', terms: ['crypto'] }))
refuses('too many terms', () => createWatch({ entity: 'Nope', terms: ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg'] }))
refuses('an entity that is too short', () => createWatch({ entity: 'x', terms: ['something'] }))
refuses('a bad owner address', () => createWatch({ entity: 'Nope', terms: ['nopecorp'], owner: 'not-an-address' }))
refuses('an official page that is not a URL', () => createWatch({ entity: 'Nope', terms: ['nopecorp'], officialUrls: ['javascript:alert(1)'] }))
refuses('hijacking the house watch terms', () => createWatch({ entity: 'Impostor', terms: ['project x'] }))

const payment: WatchPayment = {
  at: new Date().toISOString(),
  txHash: '0xfeed',
  logIndex: 0,
  blockNumber: 1,
  from: '0x1111111111111111111111111111111111111111',
  token: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  tokenSymbol: 'USDG',
  amount: 4,
  creditedUsd: 4 * WATCH.usdPerUsdg,
}
applyPayment(watch, payment)
ok('payment activates the watch', watch.status === 'active')
ok('payment funds the budget', budgetOf(watch).budgetUsd === 4 * WATCH.usdPerUsdg, `$${budgetOf(watch).budgetUsd.toFixed(2)}`)
ok('the reserve is held back', budgetOf(watch).reserve > 0 && budgetOf(watch).available < budgetOf(watch).remaining)
ok('an expiry is set', Boolean(watch.expiresAt) && Date.parse(watch.expiresAt!) > Date.now())

const routed = matchWatch('Anyone else seeing Acme Protocol withdrawals stuck? $ACME')
ok('a funded watch is matched by its terms', routed?.watch.id === watch.id, routed?.terms.join(', '))
ok('the house still owns its own terms', matchWatch('Project X withdrawals are pending')?.watch.id === HOUSE_ID)
ok('an unrelated claim matches nothing', !matchWatch('the weather in Lagos is fine'))

watch.spentUsd = budgetOf(watch).budgetUsd - 0.01
ok('a spent-out watch stops being available', budgetOf(watch).available === 0, `remaining $${budgetOf(watch).remaining.toFixed(3)}`)
ok('a spent-out watch is no longer matched', !matchWatch('Acme Protocol is down'))

const id32 = watchIdToBytes32(watch.id)
ok('the id survives the bytes32 round trip', bytes32ToWatchId(id32) === watch.id, id32)
ok('the watch is readable by id', watchById(watch.id)?.entity === 'Acme Protocol')
ok('watches list house first', watches()[0]!.id === HOUSE_ID)

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
