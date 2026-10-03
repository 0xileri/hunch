// Pure report rendering: no agent, chain calls or paid research.
import assert from 'node:assert/strict'
import { investigationPage, investigationReport, reportIsRunning } from '../web/investigation-page.js'
import { investigationHistory } from '../web/investigation-history.js'
import type { Investigation } from '../core/types.js'

const inv: Investigation = {
  id: 'inv_report', clusterId: 'cl_report', watchId: 'wat_12345678', claim: 'Withdrawals may be delayed',
  createdAt: '2026-10-03T08:00:00Z', finishedAt: '2026-10-03T08:01:00Z', status: 'complete',
  maxBudgetUsd: 0.1, estimateUsd: 0.03, spentUsd: 0.02, balanceBefore: 1, balanceAfter: 0.98, keyPrefix: null,
  contract: { task: 'Research', deadlineSec: 60, successConditions: [] },
  trigger: { score: 0.8, mentions: 2, uniqueSources: 2, last15: 2, prev15: 0 }, auctions: [], workers: [],
  evidence: [{ ref: 'S1', name: 'Status', url: 'https://example.com/status', kind: 'official', ok: true, excerpt: 'Delayed', error: null }],
  artifact: { claim: 'Withdrawals may be delayed', status: 'supported', confidence: 0.9,
    origin: { ref: 'P1', source: 'Public post', url: 'https://example.com/post', firstSeen: '2026-10-03T07:59:00Z' },
    finding: ['Status page reports a delay'], evidenceFor: [{ ref: 'S1', source: 'Status page', url: 'https://example.com/status', finding: 'Withdrawals delayed' }],
    evidenceAgainst: [], unknowns: ['Duration unknown'], recommendedAction: 'monitor', rationale: 'An official source corroborates the claim',
  },
  acceptance: { accepted: true, checks: [{ label: 'Has evidence', ok: true, detail: 'One cited source' }] },
  alert: null, error: null, demo: true,
}
const complete = investigationReport(inv)
assert.match(complete, /Supported/)
assert.match(complete, /90% confidence/)
assert.match(complete, /\$0\.0200/)
assert.match(complete, /Duration unknown/)
assert.match(complete, /href="https:\/\/example.com\/status"/)
assert.match(complete, /DEMO FIXTURE/)
assert.match(investigationPage(inv), /data-running="false"/)
assert.equal(reportIsRunning(inv), false)

const rejected = investigationReport({ ...inv, status: 'rejected', acceptance: { accepted: false, checks: [] } })
assert.match(rejected, /Verification needs review/)
assert.match(rejected, /draft awaiting review/)
assert.doesNotMatch(rejected, /90% confidence|report-verdict">Supported/)
const notAccepted = investigationReport({ ...inv, acceptance: null })
assert.doesNotMatch(notAccepted, /90% confidence|report-verdict">Supported/)
for (const status of ['funded', 'running', 'verifying'] as const) {
  const live = { ...inv, status, artifact: null, acceptance: null, finishedAt: null }
  assert.equal(reportIsRunning(live), true)
  assert.match(investigationReport(live), /Live research status/)
  assert.match(investigationPage(live), /data-running="true"/)
}
const unsafe = structuredClone(inv)
unsafe.claim = '<script>alert(1)</script>"'
unsafe.artifact!.finding = ['<img src=x onerror=alert(1)>']
unsafe.artifact!.evidenceFor[0].url = 'javascript:alert(1)'
unsafe.artifact!.evidenceFor[0].source = '<svg onload=alert(1)>'
unsafe.artifact!.origin.url = 'data:text/html,<script>alert(1)</script>'
const escaped = investigationReport(unsafe)
assert.match(escaped, /&lt;script&gt;/)
assert.match(escaped, /&lt;img/)
assert.doesNotMatch(escaped, /<script>|<img|<svg|href="javascript:|href="data:/)
const failure = investigationReport({ ...inv, status: 'failed', artifact: null, acceptance: null, error: 'Timeout <b>' })
assert.match(failure, /Research could not finish/)
assert.match(failure, /Timeout &lt;b&gt;/)
assert.doesNotMatch(failure, /90% confidence/)
const history = Array.from({ length: 45 }, (_, index) => ({ ...inv, id: 'inv_' + index, watchId: index < 37 ? 'wat_12345678' : 'wat_other', createdAt: new Date(Date.parse(inv.createdAt) + index * 1000).toISOString() }))
const first = investigationHistory(history)
assert.equal(first.total, 45); assert.equal(first.items.length, 20); assert.equal(first.nextOffset, 20)
const second = investigationHistory(history, undefined, first.nextOffset!)
const last = investigationHistory(history, undefined, second.nextOffset!)
assert.equal(second.items.length, 20); assert.equal(last.items.length, 5); assert.equal(last.nextOffset, null)
assert.equal(new Set([...first.items, ...second.items, ...last.items].map(item => item.id)).size, 45)
assert.equal(first.items[0].id, 'inv_44'); assert.equal(history[0].id, 'inv_0', 'listing must not mutate investigation state')
assert.equal(investigationHistory(history, 'wat_12345678').total, 37)
assert.equal(investigationHistory(history, 'unknown').total, 0)
assert.equal(investigationHistory([{ ...inv, status: 'rejected' }]).items[0].verdict, null)
assert.equal(investigationHistory([{ ...inv, status: 'rejected' }]).items[0].confidence, null)
console.log('PASS: readable reports, acceptance gates, draft and failed states, live research, costs, sources, safe HTML and complete paginated history')
