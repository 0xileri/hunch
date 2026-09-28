// The shapes everything else passes around. Money is always USD as Orbio reports it: the account
// balance is dollars of credit, and a call costs its tokens at the gateway's own per-token prices.

export type SourceType = 'rss' | 'reddit' | 'demo'

export interface Source {
  id: string
  name: string
  type: SourceType
  url: string
}

export interface SourceItem {
  id: string
  sourceId: string
  sourceName: string
  sourceType: SourceType
  url: string
  title: string
  text: string
  links: string[]
  publishedAt: string | null
  fetchedAt: string
  embedding: number[]
  demo: boolean
}

export type Action = 'IGNORE' | 'WATCH' | 'INVESTIGATE'

/** Every factor is normalized to 0..1 before weighting. */
export interface Factors {
  velocity: number
  diversity: number
  size: number
  severity: number
  novelty: number
}

export interface ClusterMetrics {
  mentions: number
  uniqueSources: number
  sources: string[]
  last15: number
  prev15: number
  meanSimilarity: number
  severityTerms: string[]
  missionTerms: string[]
  onMission: boolean
  firstSeen: string
  lastSeen: string
  similarTo: { clusterId: string; similarity: number } | null
}

export interface Check {
  label: string
  ok: boolean
  detail: string
}

export interface Decision {
  at: string
  /** The watch this decision was made for, null when nothing on mission matched. */
  watchId?: string | null
  score: number
  factors: Factors
  metrics: ClusterMetrics
  action: Action
  reason: string
  checks: Check[]
  estimateUsd: number | null
  budgetUsd: number
  investigationId: string | null
}

export type ClusterState = 'new' | 'ignored' | 'watching' | 'investigating' | 'resolved' | 'archived'

export interface SignalCluster {
  id: string
  representativeClaim: string
  itemIds: string[]
  centroid: number[]
  createdAt: string
  updatedAt: string
  state: ClusterState
  decisions: Decision[]
  investigationId: string | null
  demo: boolean
}

export type WorkerId = 'source-tracer' | 'cross-checker' | 'verifier'

export interface WorkerRun {
  id: WorkerId
  role: string
  /** The market worker hired for this role, and its model. */
  bidder: string
  label: string
  model: string
  status: 'waiting' | 'running' | 'done' | 'failed' | 'skipped'
  estimateUsd: number
  costUsd: number
  startedAt: string | null
  finishedAt: string | null
  output: unknown
  error: string | null
  completionTokens: number
  latencyMs: number | null
  /** A cut-off or off-schema answer gets one retry with a bigger cap; the grade remembers it. */
  retried?: boolean
  /** The code's grade of this job, which moves the worker's reputation. */
  grade: { quality: number; notes: string[]; reputationBefore: number; reputationAfter: number } | null
}

export interface Bid {
  bidder: string
  label: string
  model: string
  bidUsd: number
  worstUsd: number
  reputation: number
  jobs: number
  eligible: boolean
  utility: number | null
}

export interface Auction {
  role: WorkerId
  bids: Bid[]
  winner: string
  reason: string
}

export interface EvidenceDoc {
  ref: string
  name: string
  url: string
  kind: 'official' | 'linked'
  ok: boolean
  excerpt: string
  error: string | null
}

export type Status = 'supported' | 'partially_supported' | 'unsupported' | 'unclear'

export interface EvidenceLine {
  ref: string
  url: string
  source: string
  finding: string
}

export interface Artifact {
  claim: string
  status: Status
  confidence: number
  origin: { ref: string; url: string; source: string; firstSeen: string | null }
  finding: string[]
  evidenceFor: EvidenceLine[]
  evidenceAgainst: EvidenceLine[]
  unknowns: string[]
  recommendedAction: 'monitor' | 'alert' | 'escalate'
  rationale: string
}

export type InvestigationStatus = 'funded' | 'running' | 'verifying' | 'complete' | 'rejected' | 'failed'

export interface Investigation {
  id: string
  clusterId: string
  /** The watch whose budget paid for it. */
  watchId?: string | null
  claim: string
  createdAt: string
  finishedAt: string | null
  status: InvestigationStatus
  maxBudgetUsd: number
  estimateUsd: number
  spentUsd: number
  balanceBefore: number | null
  balanceAfter: number | null
  keyPrefix: string | null
  contract: { task: string; deadlineSec: number; successConditions: string[] }
  trigger: { score: number; mentions: number; uniqueSources: number; last15: number; prev15: number }
  auctions: Auction[]
  workers: WorkerRun[]
  evidence: EvidenceDoc[]
  artifact: Artifact | null
  acceptance: { accepted: boolean; checks: Check[] } | null
  alert: { channel: 'telegram' | 'dashboard'; sent: boolean; detail: string } | null
  error: string | null
  demo: boolean
}

export interface SpendEvent {
  id: string
  at: string
  investigationId: string
  workerId: WorkerId
  bidder?: string
  model: string
  purpose: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  costSource: 'gateway' | 'price-list'
  watchId?: string | null
  keyPrefix: string
  balanceBefore: number | null
  balanceAfter: number | null
}

/** One worker's track record in the market (see src/agent/market.ts). */
export interface WorkerRecord {
  jobs: number
  qualitySum: number
  costSum: number
  completionTokensSum: number
  latencyMsSum: number
  recent: { at: string; investigationId: string; quality: number; notes: string[] }[]
}

/** One self-refuel: an on-chain purchase and activation, then confirmation in the Orbio balance. */
export interface Refuel {
  id: string
  at: string
  trigger: 'policy' | 'operator'
  reason: string
  status: 'buying' | 'confirming' | 'confirmed' | 'unconfirmed' | 'failed'
  usdgIn: number
  usdgSpent: number | null
  creditOut: number | null
  price: number | null
  activationId: string | null
  activatedUsd: number | null
  approveTx: string | null
  buyTx: string | null
  beneficiary: string | null
  gasEth: number | null
  topUpsBefore: number | null
  topUpsAfter: number | null
  balanceBefore: number | null
  balanceAfter: number | null
  error: string | null
  /** A network or RPC failure, retried after minutes rather than an hour. */
  transient?: boolean
}

/** One payment into a watch, as read from the payment contract's `Funded` events. */
export interface WatchPayment {
  at: string
  txHash: string
  logIndex: number
  blockNumber: number
  from: string
  token: string
  tokenSymbol: string
  amount: number
  /** What that payment bought, in investigation budget. */
  creditedUsd: number
}

/** A watch: prepaid investigation budget aimed at one entity. See src/core/watches.ts. */
export interface Watch {
  id: string
  /** The operator's own mission, which spends the operator's budget and is never paid for. */
  house: boolean
  entity: string
  statement: string
  terms: string[]
  officialSources: { name: string; url: string }[]
  /** The address that paid for it, lowercase. */
  owner: string | null
  status: 'pending' | 'active' | 'expired' | 'cancelled'
  createdAt: string
  activatedAt: string | null
  expiresAt: string | null
  fundedUsd: number
  spentUsd: number
  payments: WatchPayment[]
}

export interface WatchBudget {
  budgetUsd: number
  spentUsd: number
  remaining: number
  reserve: number
  cap: number
  available: number
}
