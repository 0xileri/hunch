// Hunch: the dashboard, its API, the demo fixture's pages, and the agent's schedule, in one
// process.
import './env.js'
import { existsSync, readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  claimKey, demoCooldownLeft, holdsKey, isBusy, refuel, revokeAgentKey, rotateKey, runDemo, scan, setPaused, snapshot, startAgent,
} from './agent/coordinator.js'
import { paymentInstructions, refreshPayments } from './chain/payments.js'
import { treasuryAccount } from './chain/refuel.js'
import { ADMIN_TOKEN, PORT, PUBLIC_URL, SCHEDULE } from './config.js'
import { log } from './core/log.js'
import { saveNow, state } from './core/state.js'
import { budgetOf, createWatch, watchById, watches, WatchError, type WatchRequest } from './core/watches.js'
import type { Watch } from './core/types.js'
import { demoFeedXml } from './demo/fixture.js'
import { announcementsPage, demoIndexPage, postPage, statusPage } from './demo/pages.js'
import { APP_CSS, APP_JS } from './web/dashboard.js'
import { changelogPage } from './web/changelog.js'
import { ownerPage } from './web/owner.js'
import { WATCH_JS, watchPage } from './web/watch.js'
import { AIRDROP_JS, airdropPage } from './web/airdrop.js'
import { sitePage, howItWorksPage, SECTION_PAGES, type SectionPage } from './web/site.js'
import { withSiteNavigation } from './web/navigation.js'
import { AIRDROP, AirdropError, airdropReviewEntries, airdropStatus, confirmAirdropPayout, createAirdropChallenge, excludeAirdropPosts, reviewAirdrop, submitAirdrop } from './core/airdrop.js'
import { claimAllocation, claimCampaignStatus, claimChallenge, claimTreasuryStatus, configureClaims, executeClaim, initializeClaimTreasury, setClaimsEnabled } from './core/airdrop-claims.js'

const app = new Hono()
app.use('/api/airdrop/*', bodyLimit({ maxSize: 12000, onError: (c) => c.json({ error: 'Submission is too large.' }, 413) }))

const isAdmin = (c: Context) => !ADMIN_TOKEN || c.req.header('authorization') === `Bearer ${ADMIN_TOKEN}`
const denied = (c: Context) => c.json({ error: 'This control needs the operator token.' }, 401)
const failure = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** A watch as anyone may see it: its terms, its money, and the payments that funded it. */
const publicWatch = (w: Watch) => ({
  id: w.id,
  house: w.house,
  entity: w.entity,
  statement: w.statement,
  terms: w.terms,
  officialSources: w.officialSources,
  owner: w.owner,
  status: w.status,
  createdAt: w.createdAt,
  expiresAt: w.expiresAt,
  budget: budgetOf(w),
  payments: w.payments,
})

app.get('/', (c) => c.html(sitePage()))
app.get('/how-it-works', (c) => c.html(howItWorksPage()))
for (const page of Object.keys(SECTION_PAGES) as SectionPage[]) app.get(`/${page}`, (c) => c.html(sitePage(page)))
app.get('/watch', (c) => c.html(withSiteNavigation(watchPage(), '/watch')))
app.get('/changelog', (c) => c.html(withSiteNavigation(changelogPage(), '/changelog')))
app.get('/airdrop', (c) => c.html(withSiteNavigation(airdropPage(), '/airdrop')))
app.get('/airdrop.js', (c) => c.body(AIRDROP_JS, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }))
app.get('/api/airdrop', (c) => { c.header('cache-control', 'no-store'); return c.json({ ...AIRDROP, ...claimCampaignStatus() }) })
app.get('/api/airdrop/wallet/:wallet', (c) => {
  c.header('cache-control', 'no-store')
  try { const result = airdropStatus(c.req.param('wallet')); const reward = claimAllocation(c.req.param('wallet')); return c.json({ ...result, eligible: !!reward, campaign: { ...AIRDROP, ...claimCampaignStatus() }, allocation: reward ?? result.allocation }) }
  catch (err) { return c.json({ error: failure(err) }, 400) }
})
const airdropRate = new Map<string, { count: number; expiresAt: number }>()
app.post('/api/airdrop/:action', async (c) => {
  c.header('cache-control', 'no-store')
  const action = c.req.param('action')
  if (!['challenge', 'submit', 'claim-challenge', 'claim'].includes(action)) return c.notFound()
  const origin = c.req.header('origin')
  if (origin && origin !== new URL(PUBLIC_URL).origin) return c.json({ error: 'Submit from Hunch’s official website.' }, 403)
  // Railway supplies this client address; no forwarded header is trusted for authorization.
  const ip = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const now = Date.now()
  for (const [key, value] of airdropRate) if (value.expiresAt < now) airdropRate.delete(key)
  if (airdropRate.size > 10000) return c.json({ error: 'Busy. Try again shortly.' }, 429)
  const rate = airdropRate.get(ip) ?? { count: 0, expiresAt: now + 60000 }
  if (++rate.count > 20) return c.json({ error: 'Too many requests. Try again in a minute.' }, 429)
  airdropRate.set(ip, rate)
  try {
    const raw = await c.req.text()
    if (raw.length > 12000) return c.json({ error: 'Submission is too large.' }, 413)
    const body = JSON.parse(raw)
    if (action === 'claim-challenge') return c.json(claimChallenge(body))
    if (action === 'claim') return c.json(await executeClaim(body))
    return action === 'challenge' ? c.json(createAirdropChallenge(body)) : c.json(await submitAirdrop(body), 201)
  } catch (err) {
    if (err instanceof AirdropError || err instanceof SyntaxError) return c.json({ error: failure(err) }, 400)
    console.error('Airdrop submission failed', err)
    return c.json({ error: 'Unable to save your submission. Please try again.' }, 500)
  }
})
app.get('/api/admin/airdrop/entries', (c) => {
  // Unlike legacy controls, this endpoint must remain closed when ADMIN_TOKEN is missing.
  if (!ADMIN_TOKEN || !isAdmin(c)) return denied(c)
  c.header('cache-control', 'no-store')
  return c.json(airdropReviewEntries())
})
app.get('/api/admin/airdrop/treasury', async (c) => {
  if (!ADMIN_TOKEN || !isAdmin(c)) return denied(c)
  c.header('cache-control', 'no-store')
  try { return c.json(await claimTreasuryStatus()) } catch { return c.json({ error: 'Unable to read treasury balances.' }, 503) }
})
app.use('/api/admin/airdrop/*', bodyLimit({ maxSize: 6000, onError: (c) => c.json({ error: 'Request is too large.' }, 413) }))
app.post('/api/admin/airdrop/:id/:action', async (c) => {
  if (!ADMIN_TOKEN || !isAdmin(c)) return denied(c)
  c.header('cache-control', 'no-store')
  try {
    const body = await c.req.json()
    if (c.req.param('id') === 'treasury' && c.req.param('action') === 'initialize') return c.json(initializeClaimTreasury())
    if (c.req.param('id') === 'claims' && c.req.param('action') === 'configure') return c.json(configureClaims(body))
    if (c.req.param('id') === 'claims' && c.req.param('action') === 'enabled') return c.json(await setClaimsEnabled(body.enabled))
    if (c.req.param('action') === 'exclude-posts') return c.json(excludeAirdropPosts(c.req.param('id'), body))
    if (c.req.param('action') === 'review') return c.json(reviewAirdrop(c.req.param('id'), body))
    if (c.req.param('action') === 'payout') return c.json(await confirmAirdropPayout(c.req.param('id'), body.txHash))
    return c.notFound()
  } catch (err) { return c.json({ error: err instanceof AirdropError ? err.message : 'Unable to verify or save this review.' }, 400) }
})
// The owner's own settings. No token gate: the contract checks the signature, not this server.
app.get('/owner', (c) => c.html(withSiteNavigation(ownerPage(), '/owner')))
app.get('/watch.js', (c) => c.body(WATCH_JS, 200, { 'content-type': 'text/javascript; charset=utf-8' }))
// The logo and its exports (brand/): SVG for the page, PNG for favicons and link previews.
const BRAND_TYPES: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png' }
app.get('/brand/:file', (c) => {
  const file = c.req.param('file')
  const type = BRAND_TYPES[file.split('.').pop() ?? '']
  const path = new URL(`../brand/${file}`, import.meta.url)
  if (!type || !/^[\w-]+\.(svg|png)$/.test(file) || !existsSync(path)) return c.notFound()
  return c.body(readFileSync(path), 200, { 'content-type': type, 'cache-control': 'public, max-age=86400' })
})
app.get('/favicon.ico', (c) => c.redirect('/brand/icon-32.png', 301))
app.get('/app.js', (c) => c.body(APP_JS, 200, { 'content-type': 'text/javascript; charset=utf-8' }))
app.get('/app.css', (c) => c.body(APP_CSS, 200, { 'content-type': 'text/css; charset=utf-8' }))
// A cheap liveness check for the platform. It answers as soon as this process can serve, which is
// what lets a new container take over before the old one is stopped: /api/status serialises the
// whole agent and is far too heavy to poll. It reports readiness, not whether the agent is busy.
app.get('/healthz', (c) =>
  c.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    paused: state.agent.paused,
    scans: state.agent.scans,
  }),
)

app.get('/api/state', (c) => c.json(snapshot()))
app.get('/api/status', (c) => c.json(snapshot()))
app.get('/api/signals', (c) => c.json(snapshot().signals))
app.get('/api/signals/:id', (c) => {
  const signal = snapshot().signals.find((s) => s.id === c.req.param('id'))
  return signal ? c.json(signal) : c.json({ error: 'not found' }, 404)
})
app.get('/api/investigations/:id', (c) => {
  const inv = state.investigations.find((i) => i.id === c.req.param('id'))
  if (!inv) return c.json({ error: 'not found' }, 404)
  if (c.req.query('download')) c.header('content-disposition', `attachment; filename="hunch-${inv.id}.json"`)
  return c.json({ ...inv, spend: state.spend.filter((s) => s.investigationId === inv.id) })
})
app.get('/api/spend', (c) => c.json(state.spend))

// ── watches: what the agent sells ───────────────────────────────────────────────────────────────
// Opening one is free and does nothing on its own. The watch starts when a payment for it lands
// on chain, which the agent reads itself (src/chain/payments.ts); the server never marks it paid.
app.post('/api/watch', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'Send a JSON body.' }, 400)
  try {
    const watch = createWatch(body as WatchRequest)
    log('WATCH', `${watch.id} opened for ${watch.entity} on ${watch.terms.map((t) => `"${t}"`).join(', ')}, waiting for payment`)
    return c.json({ watch: publicWatch(watch), payment: paymentInstructions(watch) }, 201)
  } catch (err) {
    if (err instanceof WatchError) return c.json({ error: err.message }, 400)
    return c.json({ error: failure(err) }, 500)
  }
})

app.get('/api/watch/:id', async (c) => {
  let watch = watchById(c.req.param('id'))
  if (!watch) return c.json({ error: 'not found' }, 404)
  // Someone is waiting on this one: look for its payment now instead of at the next scan.
  if (!watch.house && watch.status === 'pending') {
    await refreshPayments().catch((err) => log('ERROR', `payment check failed: ${failure(err)}`))
    watch = watchById(c.req.param('id')) ?? watch
  }
  // What the agent has seen for this watch, including what it decided was not worth paying for.
  // A quiet week is the product working, but only if the customer can see the work.
  const seen = state.clusters
    .filter((cl) => cl.state !== 'archived' && cl.decisions.at(-1)?.watchId === watch.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
    .map((cl) => {
      const d = cl.decisions.at(-1)!
      const items = cl.itemIds.map((id) => state.items.get(id)).filter((i): i is NonNullable<typeof i> => !!i)
      return {
        id: cl.id,
        claim: cl.representativeClaim,
        at: cl.updatedAt,
        score: d.score,
        action: d.action,
        reason: d.reason,
        mentions: d.metrics.mentions,
        sources: [...new Set(items.map((i) => i.sourceName))],
        links: items.map((i) => i.url).filter(Boolean).slice(0, 4),
        investigationId: cl.investigationId,
      }
    })

  return c.json({
    watch: publicWatch(watch),
    payment: paymentInstructions(watch),
    seen,
    searchedUsd: watch.searchedUsd ?? 0,
    investigations: state.investigations.filter((i) => i.watchId === watch.id).map((i) => ({
      id: i.id,
      at: i.createdAt,
      claim: i.claim,
      spentUsd: i.spentUsd,
      status: i.artifact?.status ?? i.status,
      confidence: i.artifact?.confidence ?? null,
    })),
  })
})

app.get('/api/watches', (c) => c.json(watches().map(publicWatch)))

// Scanning is free, so anyone may ask for one, but not more than once a minute.
let lastPublicScan = 0
app.post('/api/scan', (c) => {
  if (!isAdmin(c) && Date.now() - lastPublicScan < 60_000) return c.json({ error: 'A scan ran less than a minute ago.' }, 429)
  if (isBusy().scanning) return c.json({ error: 'A scan is already running.' }, 409)
  lastPublicScan = Date.now()
  scan('manual scan').catch(() => {})
  return c.json({ started: true }, 202)
})

// The demo can spend (one investigation, a few cents, inside the mission budget), so public presses
// are spaced out; the budget policy still has the final say on every cent.
app.post('/api/demo/run', (c) => {
  if (isBusy().demo) return c.json({ error: 'The demo is already running.' }, 409)
  const wait = demoCooldownLeft()
  if (!isAdmin(c) && wait > 0) return c.json({ error: `The demo ran recently. Try again in ${wait}s.` }, 429)
  if (!isAdmin(c)) {
    const since = Date.now() - 24 * 3_600_000
    state.agent.publicDemos = (state.agent.publicDemos ?? []).filter((at) => Date.parse(at) > since)
    if (state.agent.publicDemos.length >= SCHEDULE.publicDemosPerDay) {
      return c.json({ error: `The public demo has run ${SCHEDULE.publicDemosPerDay} times today, its daily limit. Try again tomorrow.` }, 429)
    }
    state.agent.publicDemos.push(new Date().toISOString())
    saveNow()
  }
  runDemo().catch((err) => log('ERROR', `demo failed: ${failure(err)}`))
  return c.json({ started: true }, 202)
})

app.post('/api/key/rotate', async (c) => {
  if (!isAdmin(c)) return denied(c)
  try {
    await rotateKey('operator pressed Rotate')
    return c.json({ ok: true })
  } catch (err) {
    log('ERROR', `rotation failed: ${failure(err)}`)
    return c.json({ error: failure(err) }, 500)
  }
})
app.post('/api/key/revoke', async (c) => {
  if (!isAdmin(c)) return denied(c)
  try {
    await revokeAgentKey('operator pressed Revoke')
    return c.json({ ok: true })
  } catch (err) {
    log('ERROR', `revoke failed: ${failure(err)}`)
    return c.json({ error: failure(err) }, 500)
  }
})
app.post('/api/key/claim', async (c) => {
  if (!isAdmin(c)) return denied(c)
  try {
    await claimKey('operator pressed Claim')
    return c.json({ ok: true })
  } catch (err) {
    log('ERROR', `claim failed: ${failure(err)}`)
    return c.json({ error: failure(err) }, 500)
  }
})
app.post('/api/agent/pause', (c) => {
  if (!isAdmin(c)) return denied(c)
  setPaused(true)
  return c.json({ ok: true })
})
app.post('/api/agent/resume', (c) => {
  if (!isAdmin(c)) return denied(c)
  setPaused(false)
  return c.json({ ok: true })
})
// Refuel now, from the treasury. The policy also refuels on its own when the runway runs short.
app.post('/api/refuel', (c) => {
  if (!isAdmin(c)) return denied(c)
  if (!treasuryAccount()) return c.json({ error: 'No treasury wallet is configured.' }, 400)
  refuel('operator', 'operator pressed Refuel').catch((err) => log('ERROR', `refuel failed: ${failure(err)}`))
  return c.json({ started: true }, 202)
})
app.get('/api/operator', (c) => c.json({ required: !!ADMIN_TOKEN, ok: isAdmin(c) }))

// The demo fixture's world: four planted feeds, each post's page, and Project X's own pages.
app.get('/demo', (c) => c.html(demoIndexPage()))
app.get('/demo/feeds/:file', (c) => {
  const xml = demoFeedXml(c.req.param('file').replace(/\.xml$/, ''), PUBLIC_URL)
  return xml ? c.body(xml, 200, { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'no-store' }) : c.notFound()
})
app.get('/demo/posts/:id', (c) => {
  const html = postPage(c.req.param('id'))
  return html ? c.html(html) : c.notFound()
})
app.get('/demo/projectx/status', (c) => c.html(statusPage()))
app.get('/demo/projectx/announcements', (c) => c.html(announcementsPage()))

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Hunch on ${PUBLIC_URL}`)
  startAgent().then(() => {
    if (!SCHEDULE.enabled) return
    setTimeout(() => scan('first scan').catch(() => {}), 5_000)
    setInterval(() => {
      if (!state.agent.paused && !isBusy().scanning) scan('scheduled scan').catch(() => {})
    }, SCHEDULE.scanEveryMin * 60_000)
  })
})

// Leave no key behind: on shutdown the agent revokes its key (the balance is untouched).
let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  saveNow()
  if (holdsKey()) await Promise.race([
    revokeAgentKey(`agent shutting down (${signal})`, { hold: false }).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
