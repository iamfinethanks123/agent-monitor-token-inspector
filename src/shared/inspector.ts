import type { BenchmarkExecution, BenchmarkPreview } from './benchmark-execution';
import type { CollectorHealthSnapshot } from './collector-health';
import type { AdvicePlan } from './advice-plan';
import type { DataQualityView, SourceAvailabilityView } from './data-quality';
import type { ModelTransitionsView } from './model-transitions';
import type { RetryProgressView } from './retry-progress';
import type { ContextAttributionRequest, ContextAttributionView } from './context-attribution';
import type { AgentComparisonView, AgentComparisonRequest, AgentPurpose } from './agent-comparison';
import type { ManifestsView } from './context-manifests';
import type { OfflinePreview } from '../transport/offline';
export type Provenance = 'observed' | 'derived' | 'estimated' | 'unknown' | 'conflicted';
export type MeasurementOrigin = 'provider_response' | 'codex_counter' | 'monitor_calculation' | 'tokenizer' | 'user_annotation' | 'unknown';
export interface Metric {
  value: string | null;
  provenance: Provenance;
  origin: MeasurementOrigin;
  sourceRefs: string[];
  assumptions: string[];
  missingReason?: string;
}
export const TOKEN_FIELDS = ['input', 'cachedInput', 'cacheWriteInput', 'output', 'reasoningOutput', 'total'] as const;
export type TokenField = typeof TOKEN_FIELDS[number];
export type TokenValues = Record<TokenField, string | null>;
export type UsageComponents = Record<TokenField, Metric>;
export interface ExecutionIdentity {
  workspaceId: string;
  originMachineId: string | null;
  projectId: string | null;
  runId: string;
  agentId: string | null;
  provider: string | null;
  threadId: string | null;
  sessionId: string | null;
  rootTurnId: string | null;
  turnId: string | null;
  responseId: string | null;
}
export interface ModelAttribution {
  requestedModel: string | null;
  observedModel: string | null;
  providerRoute: string | null;
  serviceTier: string | null;
  quotaAlias: string | null;
  provenance: Provenance;
  evidenceRefs: string[];
}
export interface LedgerEntry {
  id: string;
  revision: number;
  scopeId: string;
  identity: ExecutionIdentity;
  grain: 'response' | 'interval' | 'aggregate';
  startAt: string | null;
  endAt: string | null;
  model: ModelAttribution;
  usage: UsageComponents;
  nativeTotal: Metric;
  evidenceRefs: string[];
  evidenceCount: number;
  controlObservationRefs: string[];
  selectionStatus: 'selected' | 'quarantined';
  reconciliation: 'matched' | 'partial' | 'conflicted' | 'not_comparable';
  issues: string[];
  coverage: { fromSequence: string | null; toSequence: string | null; excludesResponses: boolean; priorHistory: boolean; sourceGeneration?: number; recordSequence?: string; nativeOrdinal?: string | null; sequenceBasis?: 'native_ordinal' | 'source_record'; };
  policyVersion: string;
}
export interface SourceHealth {
  id: string;
  machineId: string;
  label: string;
  threadId: string | null;
  sessionId: string | null;
  parentThreadId: string | null;
  runtimeVersion: string | null;
  generation: number;
  bytesProcessed: string;
  fileBytes: string | null;
  records: number;
  lastSeenAt: string;
  state: 'current' | 'catching_up' | 'stale' | 'partial' | 'failed' | 'unsupported';
  capabilities: string[];
  issues: string[];
}
export type SampleCapability = 'usage_snapshots' | 'response_identity' | 'input' | 'output' | 'cached_input' | 'cache_write_input' | 'reasoning_output' | 'tool_pairing' | 'parent_links' | 'compaction' | 'model_identity' | 'source_timestamps' | 'context_manifests';
export interface SourceSampleReport {
  state: 'ready' | 'partial' | 'unsupported' | 'permission_denied' | 'unavailable';
  inspectedAt: string; adapterVersion: string; inspectionHost: { os: string; architecture: string };
  runtimeVersions: string[]; runtimeUnknown: boolean; fileBytes: string | null; sampledBytes: number;
  records: number; parsedRecords: number; unsupportedRecords: number; invalidRecords: number; oversizedRecords: number;
  pendingTailBytes: number; limited: boolean; changedDuringRead: boolean;
  capabilities: { id: SampleCapability; presentRecords: number; usableRecords: number; state: 'observed' | 'partial' | 'not_observed' | 'invalid' | 'unsupported' }[];
  toolPairing: { calls: number; results: number; matched: number };
  schemaFingerprints: { fingerprint: string; records: number }[]; schemaCount: number; reasons: string[];
}
export interface LedgerExplanationQuery { id: string; revision: number; cursor?: string; }
export interface TotalExplanationRequest { query: InspectorQuery; revision: number; usdPriceId?: string | null; expectedTotal?: string | null; expectedUsd?: { amount: string | null; upperAmount: string | null }; }
export type TotalSourceRole = 'response_support' | 'quarantined_response' | 'counter_support' | 'quarantined_counter' | 'control_only' | 'not_in_membership';
export interface TotalExplanation {
  snapshotId: string; capturedAt: string; expiresAt: string; query: InspectorQuery; revision: number;
  summary: InspectorSummary; usd: ManualUsdView; membershipCount: number; sourceMeasurementCount: number;
  additionalResponseSupports: number; roles: { role: TotalSourceRole; measurements: number }[];
}
export interface TotalExplanationPage {
  snapshotId: string; section: 'members' | 'sources'; page: number; total: number; hasNext: boolean;
  members: { entry: LedgerEntry; usdUnits: string | null; usdUpperUnits: string | null; unpricedReason: string | null }[];
  sources: { id: string; evidenceRef: string; sourceId: string; recordingMachineId: string; timestamp: string | null;
    kind: string; role: TotalSourceRole; values: TokenValues; nativeTotal: string | null; issues: string[]; memberIds: string[]; memberCount: number }[];
}
export interface LedgerExplanation {
  entry: LedgerEntry; activeRevision: number; privacyVersion: string; analysisEpoch: string;
  observationCount: number; supportCount: number; controlCount: number;
  observations: { id: string; evidenceRef: string; sourceId: string; recordingMachineId: string; relation: 'support' | 'control';
    sequence: string; generation: number; line: number; byteStart: string; byteEnd: string; timestamp: string | null; kind: string;
    issues: string[]; measurements: { kind: string; responseId: string | null; values: TokenValues; nativeTotal: string | null; issues: string[] }[] }[];
  nextCursor: string | null;
  historyCount: number; history: { revision: number; createdAt: string; policyVersion: string; selectionStatus: LedgerEntry['selectionStatus'];
    grain: LedgerEntry['grain']; total: string | null; evidenceCount: number; issues: string[] }[];
}
export interface InspectorSummary {
  revision: number;
  usage: UsageComponents;
  selectedEntries: number;
  identifiedResponses: number;
  intervals: number;
  aggregates: number;
  quarantinedEntries: number;
  untimedTotal: Metric;
  cacheCoveredInput: Metric;
  cacheCoveredRead: Metric;
  cacheUncoveredInput: Metric;
  modelsUnidentified: number;
  sourceCount: number;
  coverageNotes: string[];
}
export interface InspectorEvent {
  id: string;
  sourceId: string;
  threadId: string | null;
  timestamp: string | null;
  kind: string;
  evidenceRef: string;
  byteStart: string;
  byteEnd: string;
  line: number;
  supported: boolean;
}
export interface EvidenceView {
  id: string;
  state: 'available' | 'source_missing' | 'source_changed' | 'unavailable' | 'policy_denied';
  excerpt: string | null;
  truncated: boolean;
  captureScope: 'local_source_record';
  byteStart: string;
  byteEnd: string;
  redactionPolicyId: string;
}
export interface InspectorPage<T> { revision: number; items: T[]; nextCursor: string | null; }
export interface InspectorQuery {
  runId?: string;
  machineId?: string;
  agentId?: string;
  cursor?: string;
  limit?: number;
  includeQuarantined?: boolean;
  days?: number;
  requestedModel?: string;
  attributedModel?: string;
  projectId?: string;
  provider?: string | null;
  serviceTier?: string | null;
  agentMode?: 'exclusive' | 'inclusive';
  from?: string;
  to?: string;
}
export type TimelineLane = 'usage' | 'tools' | 'messages' | 'errors' | 'compaction' | 'gaps' | 'other';
export interface TimelineQuery extends InspectorQuery { search?: string; eventKind?: string; lane?: TimelineLane; toolName?: string; fileIdentity?: string; callId?: string; findingId?: string; evidenceRef?: string; includeUnknownTime?: boolean; order?: 'source' | 'time'; direction?: 'asc' | 'desc'; }
export interface ScopeOptions { providers: (string | null)[]; serviceTiers: (string | null)[]; agents: { id: string; machineId: string; parentId: string | null }[]; }
export interface TimelineEvent extends InspectorEvent { lane: TimelineLane; sequence: string; generation: number; machineId: string; projectId: string | null; requestedModel: string | null; observedModel: string | null; provider: string | null; serviceTier: string | null; turnId: string | null; toolName: string | null; callId: string | null; fileIdentity: string | null; operation: string | null; issues: string[]; sourceUsage: { kind: string; total: string | null; input: string | null; output: string | null }[]; ledger: { id: string; grain: string; total: string | null; status: string }[]; }
export interface TimelineState { watermark: string; privacyVersion: string; analysisEpoch: string; }
export interface TimelinePage extends InspectorPage<TimelineEvent>, TimelineState { startCursor: string; snapshotAt: string; matchedEvents: number; unknownTimes: number; eventKinds: string[]; agents: { id: string; machineId: string; events: number }[]; laneCounts: { lane: TimelineLane; events: number }[]; retainedGaps: number; excludedSources: number; notes: string[]; }
export interface InvestigationMarker { id: string; kind: 'finding' | 'gap' | 'compaction' | 'retry'; title: string; timestamp: string | null; timeBasis: 'source' | 'unknown'; sourceId: string; machineId: string; threadId: string | null; evidenceRef: string; findingId?: string; state?: string; }
export interface TimelineInvestigations { revision: number; privacyVersion: string; computedAt: string; markers: InvestigationMarker[]; limited: boolean; notes: string[]; }
export interface AnalyticsBucket { name: string; input: string | null; output: string | null; cachedInput: string | null; reasoningOutput: string | null; total: string | null; responseTotal: string; intervalTotal: string; entries: number; }
export interface InspectorAnalytics {
  revision: number;
  timezone: 'Asia/Hong_Kong';
  buckets: AnalyticsBucket[];
  models: AnalyticsBucket[];
  projects: AnalyticsBucket[];
  machines: AnalyticsBucket[];
  untimedTotal: string;
  modelAttribution: 'requested_model';
}
export interface LegacyDevice { id: string; name: string; lastSeen: string | null; online: boolean; events: number; input: string | null; output: string | null; total: string | null; }
export interface LegacyOverview { available: boolean; devices: LegacyDevice[]; total: string | null; note: string; }
export interface ToolView {
  id: string; sourceId: string; threadId: string | null; callId: string; name: string; operation: string;
  generation: number | null;
  startedAt: string | null; completedAt: string | null; durationMs: number | null;
  status: 'completed' | 'failed' | 'running' | 'unknown' | 'conflicted';
  argumentBytes: string | null; argumentEstimate: Metric;
  outputBytes: string | null; payloadEstimate: Metric; origin: string; captureComplete: boolean | null;
  evidenceRefs: string[]; pairedBy: 'provider_id' | 'unpaired';
}
export interface ToolActivityCounts {
  records: number; invocations: number; unpaired: number; failed: number; conflicted: number;
  measuredArguments: number; argumentBytes: string | null; measuredArgumentEstimates: number; argumentEstimate: string | null;
  outputs: number; measuredOutputs: number; outputBytes: string | null;
  measuredEstimates: number; payloadEstimate: string | null; partialOutputs: number; unknownCaptureOutputs: number;
  comparableOutputs: number; repeatedOutputRecords: number; repeatedOutputBytes: string | null;
  measuredDurations: number; durationMs: string | null;
}
export interface ToolActivityGroup extends ToolActivityCounts { name: string; operation: string; evidenceRefs: string[]; }
export interface ToolActivityView { revision: number; observationRevision: number; toolIdentityVersion: 'codex-tool/2'; totals: ToolActivityCounts; groups: ToolActivityGroup[]; groupCount: number; groupLimit: number; }
export interface FindingView {
  id: string; detectorId: string; detectorVersion: string; title: string; confidence: 'low' | 'medium' | 'high';
  severity: 'info' | 'warning'; observedFacts: string[]; hypotheses: string[]; alternativeExplanations: string[];
  evidenceRefs: string[]; associatedLedgerEntryIds: string[]; associatedUsage: Metric; duplicatePayloadEstimate: Metric;
  avoidableTokens: Metric; recommendations: string[]; qualityRisk: string; validation: string; suppressionReasons: string[];
  annotation: 'actionable' | 'intentional' | 'not_relevant' | 'incorrect' | 'resolved' | null;
  plan?: AdvicePlan;
  occurrences?: number; latestEvidenceRef?: string; lastObservedAt?: string | null;
}
export interface ContextCategory { origin: string; bytes: string; estimate: Metric; occurrences: number; }
export interface CompactionView {
  id: string; sourceId: string; machineId: string; threadId: string | null; generation: number;
  itemId: string | null; timestamp: string | null; startedAt: string | null; completedAt: string | null;
  durationMs: number | null; intervalMs: number | null; trigger: 'unknown'; state: 'started' | 'completed' | 'observed';
  contextEpoch: string; evidenceRef: string; evidenceRefs: string[]; markers: number;
  deduplication: 'item_id' | 'adjacent_alias' | 'standalone'; overhead: Metric;
  before: { ledgerId: string; timestamp: string | null; model: string | null; input: Metric } | null;
  after: { ledgerId: string; timestamp: string | null; model: string | null; input: Metric } | null;
  inputChange: string | null; issues: string[];
}
export interface DiagnosticsView {
  revision: number; tools: ToolView[]; nextToolsCursor: string | null; findings: FindingView[];
  context: ContextCategory[]; compactions: CompactionView[];
  compactionCount: number; compactionCompleted: number; compactionMarkers: number; compactionUnknownTimes: number;
  associatedUnionUsage: Metric; notes: string[]; retries: RetryProgressView;
}
export interface BenchmarkProtocol {
  suiteId: string; datasetRevision: string; repositoryRevision: string; acceptanceSuite: string;
  changedVariables: ('instructions' | 'tool_output' | 'decomposition' | 'model' | 'configuration')[];
  ordering: 'paired' | 'randomized' | 'recorded'; minimumTrials: number;
}
export interface TrialConfiguration {
  datasetRevision: string; repositoryRevision: string; model: string; configuration: string;
  pairId: string | null; order: number; rerunOf: string | null; uncontrolledFactors: string[];
}
export interface RecordedToolIntervals {
  knownUnionMs: string | null; indexedCalls: number; timedCalls: number; missingCalls: number; invalidCalls: number;
  clockScope: 'single_machine' | 'unverified'; recordedComplete: boolean;
}
export interface TrialResources {
  toolIntervals?: RecordedToolIntervals | null;
  knownTokens: string; uncachedInput: string | null; observedWindowMs: string | null;
  observedFrom: string | null; observedTo: string | null; requestedModels: string[]; projectIds: string[];
  observedModels?: string[]; providers?: (string | null)[]; serviceTiers?: (string | null)[]; agentIds?: string[];
  toolCalls: number | null; failedToolCalls: number | null; retryCandidates: number | null; compactionRecords: number | null;
  compactionOperations?: number | null;
  prices: { currency: string; amount: string }[]; unpricedEntries: number; priceSnapshotIds: string[];
  sourceIds: string[]; selectedEntries: number; quarantinedEntries: number; issues: string[];
}
export interface TaskContract { id: string; runId: string; revision: number; objective: string; acceptance: string; environment: string; createdAt: string; protocol?: BenchmarkProtocol | null; permittedScope?: string | null; }
export interface RunTaskView { runId: string; contract: TaskContract | null; contractCount: number; trials: Pick<TrialRecord, 'id' | 'contractRevision' | 'outcome' | 'acceptanceReviewed' | 'createdAt' | 'evidenceRefs' | 'excludedReason'>[]; truncated: boolean; notes: string[]; }
export type OutcomeStatus = 'verified_success' | 'verified_failure' | 'partial' | 'cancelled' | 'unverified' | 'setup_failed';
export interface TrialRecord {
  id: string; contractId: string; contractRevision: number; runId: string | null; variant: string; outcome: OutcomeStatus;
  acceptanceReviewed: boolean; evidenceRefs: string[]; environment: string; cacheCondition: 'observed' | 'controlled' | 'uncontrolled' | 'unknown';
  createdAt: string; tokens: string | null; revision: number; excludedReason: string | null;
  machineId?: string | null; configuration?: TrialConfiguration | null; resources?: TrialResources; executionId?: string | null; artifactRefs?: string[]; execution?: BenchmarkExecution;
}
export interface ResourceDistribution { count: number; missing: number; minimum: string | null; median: string | null; maximum: string | null; }
export interface ExperimentVariant {
  contractId: string; variant: string; trials: number; accepted: number; failedOrCancelled: number; totalTokens: string | null; knownTokens: string;
  medianAcceptedTokens: string | null; eligible: boolean; reasons: string[];
  distributions: { tokens: ResourceDistribution; uncachedInput: ResourceDistribution; observedWindowMs: ResourceDistribution; toolIntervalUnionMs: ResourceDistribution; failedToolCalls: ResourceDistribution; retryCandidates: ResourceDistribution; compactionRecords: ResourceDistribution };
  priceDistributions: { currency: string; amounts: ResourceDistribution }[]; unpricedTrials: number;
}
export interface ExperimentView { contracts: TaskContract[]; trials: TrialRecord[]; variants: ExperimentVariant[]; recommendation: string | null; recommendations: { contractId: string; variant: string | null; reasons: string[] }[]; truncated: boolean; notes: string[]; }
export interface PairedSelection { referenceVariant: string; candidateVariant: string; }
export interface PairedMetric { key: string; unit: string; reference: string | null; candidate: string | null; delta: string | null; }
export interface PairedDifference { id: string; pairId: string | null; referenceIds: string[]; candidateIds: string[]; referenceRevisions: number[]; candidateRevisions: number[]; referencePriceIds: string[]; candidatePriceIds: string[]; referenceOutcome: OutcomeStatus | null; candidateOutcome: OutcomeStatus | null; accepted: boolean; issues: string[]; metrics: PairedMetric[]; }
export interface PairedComparison { version: 'paired-difference/1'; contractId: string; selection: PairedSelection; available: boolean; issues: string[]; pairs: PairedDifference[]; selectedTrials: number; acceptedPairs: number; summaries: { key: string; unit: string; differences: ResourceDistribution }[]; }
export interface ReportOptions { contractId?: string; table?: 'ledger' | 'findings' | 'trials' | 'paired-trials' | 'agent-comparison' | 'context-origins' | 'data-quality' | 'advice-plan' | 'tool-activity' | 'detector-evaluation'; findingId?: string; includeTaskNotes?: boolean; pairedComparison?: PairedSelection; }
export type BudgetMetric = 'tokens' | 'uncached_input' | 'elapsed_ms' | 'api_estimate';
export interface BudgetPolicy { id: string; query: InspectorQuery; tokenLimit: string; baseline: string | null; createdAt: string; metric?: BudgetMetric; currency?: string; lastValue?: string | null; crossedAt?: string | null; historical?: boolean; }
export interface BudgetState { policies: (BudgetPolicy & { current: string | null; crossed: boolean; historical: boolean; issues: string[] })[]; }
export interface TimeChartBucket { startAt: string; endAt: string; total: string | null; input: string | null; output: string | null; cachedInput: string | null; reasoning: string | null; knownUncachedInput: string; cacheCoveredInput: string; cacheCoveredCached: string; reasoningCoveredOutput: string; reasoningCoveredReasoning: string; responseTotal: string; responseEntries: number; intervalEntries: number; entries: number; usdUnits: string | null; usdUpperUnits: string | null; usdUnpriced: number; partialFields: string[]; }
export interface TimeChartGroup { id: string; total: string; entries: number; usdUnits: string | null; usdUpperUnits: string | null; usdUnpriced: number; }
export interface TimeChartView { revision: number; from: string; to: string; windowMinutes: number; bucketMinutes: number; buckets: TimeChartBucket[]; machines: TimeChartGroup[]; models: TimeChartGroup[]; projects: TimeChartGroup[]; timedKnownTotal: string; untimedKnownTotal: string; excludedQuarantined: number; missingTimedTotals: number; usdPrice: ManualUsdPrice | null; timedUsdUnits: string | null; timedUsdUpperUnits: string | null; usdUnpricedEntries: number; notes: string[]; }
export interface IncidentRecord { id: string; sourceId: string; query: InspectorQuery; detectorId: string; title: string; occurrences: number; firstSeenAt: string; lastSeenAt: string; lastObservedAt: string | null; revision: number; updates: number; lastNotifiedAt: string | null; historical: boolean; suppressionReasons: string[]; dataIssues: string[]; evidenceRefs: string[]; annotation: FindingView['annotation']; }
export interface AlertSuppression { id: string; detectorId: string; query: InspectorQuery; createdAt: string; expiresAt: string | null; }
export interface IncidentView { items: IncidentRecord[]; suppressions: AlertSuppression[]; notes: string[]; }
export interface ProjectPolicySyncView { state: 'local' | 'pending' | 'applied' | 'revoked'; version: string; applied: number; pending: number; lastAppliedAt: string | null; }
export interface DeviceView { projectPolicySync?: ProjectPolicySyncView; health?: CollectorHealthSnapshot | null; id: string; name: string; platform: string | null; state: 'local' | 'pending' | 'active' | 'revoked'; lastSeenAt: string | null; acknowledgedSequence: string; total: string | null; pendingDeletions: number; appliedDeletions: number; credentialConfirmedAt: string | null; transportGaps: number; offlineRegisteredAt: string | null; lastOnlineSeenAt: string | null; online: boolean; lastIngestMode: string | null; }
export interface ReceiverView { endpoint: string; listening: boolean; devices: DeviceView[]; error: string | null; usageRevision?: number; }
export type ReceiverActivityView = Omit<ReceiverView, 'devices' | 'usageRevision'> & { devices: Omit<DeviceView, 'total'>[] };
export interface PriceTier { minimumInput: string; inputRate: string; cachedInputRate: string; outputRate: string; }
export interface PriceSnapshot { id: string; provider: string; model: string; serviceTier: string | null; currency: string; effectiveAt: string; sourceUrl: string; asOf: string; reviewed: true; attribution: 'observed' | 'requested_reviewed'; cacheWritePolicy: 'included' | 'unsupported'; tiers: PriceTier[]; }
export interface PriceAnalytics { revision: number; mode: 'historical' | 'current'; cards: PriceSnapshot[]; currencies: { currency: string; amount: string; pricedEntries: number; tokenSubtotal: string; }[]; unpricedEntries: number; reasons: { reason: string; entries: number }[]; snapshotIds: string[]; notes: string[]; }
export interface AutomaticUsdModel { model: string; inputRate: string; cachedInputRate: string; cacheWriteRate: string; outputRate: string; sourceUrl: string; serviceMultipliers: Record<string, string>; }
export interface ManualUsdPrice { id: string; mode: 'automatic' | 'uniform' | 'components'; currency: 'USD'; provenance: 'user_defined' | 'official_snapshot'; uniformRate: string | null; inputRate: string | null; cachedInputRate: string | null; outputRate: string | null; createdAt: string; catalog?: AutomaticUsdModel[]; }
export interface ManualUsdView { revision: number; price: ManualUsdPrice | null; amount: string | null; upperAmount: string | null; pricedEntries: number; pricedTokens: string; unpricedEntries: number; complete: boolean; reasons: { reason: string; entries: number }[]; assumptions: { assumption: string; entries: number }[]; breakdown: { days: TimeChartGroup[]; machines: TimeChartGroup[]; models: TimeChartGroup[]; projects: TimeChartGroup[] }; notes: string[]; }
export interface TraceRoot { id: string; label: string; path: string; enabled: boolean; }
export interface RetentionPolicy { eventDays: number; usageDays: number; rawCopies: false; textSearch: false; }
export interface ProjectPrivacyPolicy { projectId: string; metadataDays: number | null; usageDays: number | null; contentDays: number; allowExports: boolean; allowSourcePreview: boolean; excluded: boolean; updatedAt: string | null; }
export interface ProjectPrivacyItem { id: string; observations: number; sources: number; retainedContent: number; policy: ProjectPrivacyPolicy; }
export interface ContentExcerpt { text: string; truncated: boolean; redactionPolicyId: string; }
export interface ContentSearchItem extends ContentExcerpt { id: string; evidenceRef: string; sourceId: string; projectId: string; machineId: string; threadId: string | null; generation: number; kind: string; timestamp: string | null; receivedAt: string; expiresAt: string; }
export interface ContentSearchPage { retained: number; items: ContentSearchItem[]; nextCursor: string | null; limits: { excerptBytes: number; projectBytes: number; workspaceBytes: number; workspaceRecords: number }; }
export interface ProjectDeletionPlan { projectId: string; observations: number; usageObservations: number; sources: number; mixedSources: number; revision: number; }
export interface PrivacyView { roots: TraceRoot[]; retention: RetentionPolicy; projects: ProjectPrivacyItem[]; excludedSources: number; auditEntries: number; }
export interface ReparseResult { revision: number; sourcesReparsed: number; unavailable: { sourceId: string; reason: string }[]; cancelled?: boolean; }
export interface ReparseState {
  schemaVersion: 'reparse-operation/1'; id: string; state: 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  startedAt: string; updatedAt: string; finishedAt: string | null;
  totalSources: number | null; sourcesReparsed: number; unavailable: number; revision: number; error: string | null;
}
export interface QuotaWindow { usedPercent: string | null; windowMinutes: string | null; resetsAt: string | null; issues: string[]; }
export interface QuotaMeasurement { limitId: string | null; primary: QuotaWindow | null; secondary: QuotaWindow | null; }
export interface QuotaSnapshot extends QuotaMeasurement { id: string; sourceId: string; machineId: string; measuredAt: string | null; evidenceRef: string; accountIdentity: 'unverified'; }
export interface QuotaView { mode: 'passive'; state: 'available' | 'unavailable'; snapshots: QuotaSnapshot[]; history: QuotaSnapshot[]; accountTotal: Metric; reconciliationGap: Metric; liveConnection: 'disabled'; notes: string[]; }
export interface AccountReadView {
  state: 'available' | 'unavailable'; measuredAt: string | null; accountLabel: string | null;
  error: 'CLI_UNAVAILABLE' | 'SIGN_IN_REQUIRED' | 'UNSUPPORTED_ACCOUNT' | 'TIMEOUT' | 'CONNECTION_CLOSED' | 'USAGE_UNAVAILABLE' | 'INVALID_RESPONSE' | null;
}
export interface AccountUsageView extends AccountReadView {
  lifetimeTokens: string | null; peakDailyTokens: string | null;
  dailyUsageBuckets: { startDate: string; tokens: string }[] | null;
}
export interface AccountLimitWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null; }
export interface AccountLimitBucket {
  id: string; name: string | null; primary: AccountLimitWindow | null; secondary: AccountLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
}
export interface AccountRateLimitsView extends AccountReadView {
  buckets: AccountLimitBucket[]; ordinaryUsageAllowed: boolean | null; availableResetCredits: string | null;
}
export interface InspectorBridge {
  accountUsage(): Promise<AccountUsageView>;
  accountRateLimits(): Promise<AccountRateLimitsView>;
  fingerprintAccess(): Promise<FingerprintAccessView>;
  retryFingerprintAccess(): Promise<{ accepted: boolean }>;
  onFingerprintAccess(callback: (state: FingerprintAccessView) => void): () => void;
  inspectSourceSample(): Promise<{ cancelled: boolean; report?: SourceSampleReport }>;
  summary(query?: InspectorQuery): Promise<InspectorSummary>;
  ledger(query?: InspectorQuery): Promise<InspectorPage<LedgerEntry>>;
  explainLedger(query: LedgerExplanationQuery): Promise<LedgerExplanation>;
  explainTotal(value: TotalExplanationRequest): Promise<TotalExplanation>;
  explainTotalPage(value: { snapshotId: string; section: 'members' | 'sources'; page: number; status?: 'selected' | 'quarantined' }): Promise<TotalExplanationPage>;
  events(query?: InspectorQuery): Promise<InspectorPage<InspectorEvent>>;
  timeline(query?: TimelineQuery): Promise<TimelinePage>;
  contentSearch(query: InspectorQuery & { search?: string }): Promise<ContentSearchPage>;
  timelineState(): Promise<TimelineState>;
  timelineInvestigations(query?: InspectorQuery): Promise<TimelineInvestigations>;
  scopeOptions(): Promise<ScopeOptions>;
  dataQuality(query?: InspectorQuery): Promise<DataQualityView>;
  sourceAvailability(sourceIds: string[]): Promise<SourceAvailabilityView>;
  modelTransitions(query?: InspectorQuery): Promise<ModelTransitionsView>;
  sources(): Promise<SourceHealth[]>;
  analytics(query?: InspectorQuery): Promise<InspectorAnalytics>;
  timeCharts(query: InspectorQuery, windowMinutes: number, bucketMinutes: number): Promise<TimeChartView>;
  legacy(): Promise<LegacyOverview>;
  diagnostics(query?: InspectorQuery): Promise<DiagnosticsView>;
  agentComparison(request?: AgentComparisonRequest): Promise<AgentComparisonView>;
  setAgentPurpose(agentId: string, purpose: AgentPurpose | null): Promise<void>;
  annotateAgentComparison(request: AgentComparisonRequest, id: string, choice: NonNullable<FindingView['annotation']>): Promise<void>;
  tools(query?: InspectorQuery): Promise<InspectorPage<ToolView>>;
  toolActivity(query?: InspectorQuery): Promise<ToolActivityView>;
  annotate(id: string, choice: NonNullable<FindingView['annotation']>): Promise<void>;
  experiments(contractId?: string): Promise<ExperimentView>;
  runTask(input: { runId: string; machineId?: string }): Promise<RunTaskView>;
  prepareBenchmark(contractId: string): Promise<{ cancelled: boolean; preview?: BenchmarkPreview }>;
  runBenchmark(planId: string): Promise<{ cancelled: boolean; execution?: BenchmarkExecution }>;
  cancelBenchmark(executionId: string): Promise<void>;
  benchmarkExecutions(contractId?: string): Promise<BenchmarkExecution[]>;
  saveContract(value: { runId: string; objective: string; acceptance: string; environment: string; protocol?: BenchmarkProtocol | null; permittedScope?: string | null }): Promise<TaskContract>;
  importTrial(value: Omit<TrialRecord, 'createdAt' | 'tokens' | 'revision' | 'resources'>): Promise<TrialRecord>;
  budgets(): Promise<BudgetState>;
  setBudget(value: { query: InspectorQuery; tokenLimit: string; metric?: BudgetMetric; currency?: string }): Promise<void>;
  removeBudget(id: string): Promise<void>;
  incidents(query?: InspectorQuery): Promise<IncidentView>;
  suppressAlerts(value: { query: InspectorQuery; detectorId: string; hours: number }): Promise<void>;
  removeSuppression(id: string): Promise<void>;
  report(query: InspectorQuery, format: 'markdown' | 'json' | 'csv', options?: ReportOptions): Promise<{ body: string; format: string; revision: number; previewId: string }>;
  copyReport(previewId: string): Promise<{ copied: boolean; auditRecorded: boolean }>;
  exportReport(previewId: string): Promise<{ saved: boolean; filename?: string; auditRecorded?: boolean }>;
  devices(): Promise<ReceiverView>;
  deviceActivity?(): Promise<ReceiverActivityView>;
  enrollDevice(name: string, deviceId?: string): Promise<{ saved: boolean; deviceId?: string; filename?: string }>;
  revokeDevice(id: string): Promise<void>;
  previewOfflineFile(): Promise<{ cancelled: boolean; previewId?: string; filename?: string; preview?: OfflinePreview }>;
  importOfflineFile(previewId: string): Promise<{ acknowledgedSequence: string; importedBatches: number; repeatedBatches: number; interrupted: string | null }>;
  prices(query?: InspectorQuery, mode?: 'historical' | 'current'): Promise<PriceAnalytics>;
  savePrice(value: Omit<PriceSnapshot, 'id'>): Promise<PriceSnapshot>;
  manualUsd(query?: InspectorQuery): Promise<ManualUsdView>;
  setManualUsd(value: { mode: 'automatic' | 'uniform' | 'components'; uniformRate?: string; inputRate?: string; cachedInputRate?: string; outputRate?: string }): Promise<ManualUsdPrice>;
  clearManualUsd(): Promise<void>;
  privacy(): Promise<PrivacyView>;
  addRoot(): Promise<{ added: boolean }>;
  setRoot(id: string, enabled: boolean): Promise<void>;
  setRetention(value: RetentionPolicy): Promise<void>;
  setProjectPrivacy(value: ProjectPrivacyPolicy): Promise<void>;
  deleteProject(projectId: string): Promise<{ deleted: boolean }>;
  deleteSource(id: string): Promise<{ deleted: boolean }>;
  reindex(): Promise<ReparseResult>;
  cancelReparse(operationId: string): Promise<{ requested: boolean }>;
  reparseState(): Promise<ReparseState | null>;
  onReparseProgress(callback: (state: ReparseState) => void): () => void;
  quotas(query?: InspectorQuery): Promise<QuotaView>;
  manifests(query?: InspectorQuery): Promise<ManifestsView>;
  contextAttribution(request?: ContextAttributionRequest): Promise<ContextAttributionView>;
  setManifestConsent(enabled: boolean): Promise<void>;
  importManifests(): Promise<{ imported: number; cancelled?: boolean }>;
  status(): Promise<InspectorStatus>;
  evidence(id: string): Promise<EvidenceView>;
  refresh(): Promise<void>;
  onChanged(callback: () => void): () => void;
  onDevicesChanged?(callback: () => void): () => void;
}

export interface CollectorResources { measuredAt: string; cpuPercent: number | null; processRssBytes: string; workerHeapUsedBytes: string; databaseBytes: string | null; walBytes: string | null; runtimeVersion: string; scope: 'monitor_process'; cpuBasis: 'one_core_percent'; }
export interface InspectorStatus { resources?: CollectorResources; phase: 'starting' | 'indexing' | 'ready' | 'degraded'; lastScanAt: string | null; errors: string[]; fingerprinting: 'available' | 'unavailable'; scanBlocked?: { reason: 'STORAGE_FULL' | 'STORAGE_PERMISSION_REQUIRED'; detectedAt: string }; }
export interface FingerprintAccessView { state: 'reading' | 'available' | 'startup_timeout' | 'keychain_timeout' | 'unavailable' | 'failed'; phase: 'starting' | 'keychain' | 'complete'; }

declare global { interface Window { tokenInspector?: InspectorBridge } }
