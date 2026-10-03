import { readFileSync } from 'node:fs'
import type { Investigation } from '../core/types.js'

export const HISTORY_JS = readFileSync(new URL('./investigation-list.js', import.meta.url), 'utf8')

/** Small public summaries, with a bounded page size, independent of the console's latest ten. */
export function investigationHistory(investigations: Investigation[], watchId?: string, offset = 0) {
  const reports = investigations.filter(inv => !watchId || inv.watchId === watchId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const limit = 20
  const items = reports.slice(offset, offset + limit).map(inv => {
    const accepted = inv.status === 'complete' && inv.acceptance?.accepted === true
    return { id: inv.id, watchId: inv.watchId, claim: inv.claim, createdAt: inv.createdAt, status: inv.status,
      verdict: accepted ? inv.artifact?.status ?? null : null, confidence: accepted ? inv.artifact?.confidence ?? null : null,
      accepted, spentUsd: inv.spentUsd, demo: inv.demo }
  })
  return { items, total: reports.length, offset, nextOffset: offset + items.length < reports.length ? offset + items.length : null }
}
