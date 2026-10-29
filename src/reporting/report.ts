import { dataQuality } from '../diagnostics/data-quality';
import { contextAttribution } from '../diagnostics/context-attribution';
import { InspectorStore, validateQuery, withinDates } from '../storage/InspectorStore';
import { csvCell, redactText } from './privacy';
import { ADAPTER_VERSION, POLICY_VERSION, object } from '../accounting/codex-observations';
import type { InspectorQuery, LedgerEntry, ReportOptions, TaskContract, TrialRecord } from '../shared/inspector';
import { priceAnalytics } from '../accounting/prices';
import { agentComparison } from '../diagnostics/agent-comparison';
import { analyze, toolActivity } from '../diagnostics/analyze';
import { experiments } from '../benchmarks/experiments';
import { incidents } from '../diagnostics/incidents';
import { manualUsd } from '../accounting/manual-usd';
import { assertProjectExports, privacyVersion, reportProjects } from '../storage/project-privacy';
import detectorResults from '../shared/detector-corpus-results.json';
import { pairedComparison } from '../shared/paired-comparison';

const markdown = (value: string) => redactText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\\`*_{}[\]()#!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
const clean = (value: unknown): unknown => typeof value === 'string' ? redactText(value) : Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value;
function options(value: unknown): ReportOptions {
  if (value === undefined) return {};
  const input = object(value); if (!input || Object.keys(input).some(key => !['contractId', 'table', 'findingId', 'includeTaskNotes', 'pairedComparison'].includes(key))) throw new Error('INVALID_REPORT_OPTIONS');
  if (input.contractId !== undefined && (typeof input.contractId !== 'string' || !input.contractId || input.contractId.length > 128)) throw new Error('INVALID_REPORT_OPTIONS');
  if (input.table !== undefined && !['ledger', 'findings', 'trials', 'paired-trials', 'agent-comparison', 'context-origins', 'data-quality', 'advice-plan', 'tool-activity', 'detector-evaluation'].includes(String(input.table))) throw new Error('INVALID_REPORT_OPTIONS');
  if (input.findingId !== undefined && (typeof input.findingId !== 'string' || !/^finding:[a-f0-9]{64}$/.test(input.findingId) || input.table !== 'advice-plan')) throw new Error('INVALID_REPORT_OPTIONS');
  if (input.table === 'advice-plan' && !input.findingId) throw new Error('INVALID_REPORT_OPTIONS');
  if (input.includeTaskNotes !== undefined && typeof input.includeTaskNotes !== 'boolean') throw new Error('INVALID_REPORT_OPTIONS');
  if (input.pairedComparison !== undefined) {
    const pair = object(input.pairedComparison);
    if (!input.contractId || input.table !== 'paired-trials' || !pair || Object.keys(pair).length !== 2 || !['referenceVariant', 'candidateVariant'].every(key => typeof pair[key] === 'string' && (pair[key] as string).length > 0 && (pair[key] as string).length <= 256) || pair.referenceVariant === pair.candidateVariant) throw new Error('INVALID_REPORT_OPTIONS');
  } else if (input.table === 'paired-trials') throw new Error('INVALID_REPORT_OPTIONS');
  return input as ReportOptions;
}
function contractView(contract: TaskContract, include: boolean) {
  return { definitionProvenance: 'user_annotation', id: contract.id, referenceRunId: contract.runId, revision: contract.revision, createdAt: contract.createdAt, protocol: contract.protocol ?? null,
    ...(include ? { objective: redactText(contract.objective), acceptance: redactText(contract.acceptance), environment: redactText(contract.environment), permittedScope: contract.permittedScope ? redactText(contract.permittedScope) : null } : { taskNotes: 'omitted_by_policy' }) };
}
function trialView(trial: TrialRecord, include: boolean) {
  const { environment, excludedReason, configuration, ...rest } = trial;
  const execution = trial.execution ? { ...trial.execution, planDigest: 'omitted_by_policy', inputFiles: trial.execution.inputFiles.map(({ id, role, bytes }) => ({ id, role, bytes })), outputFiles: trial.execution.outputFiles.map(({ id, role, bytes, summary }) => ({ id, role, bytes, summary })) } : undefined;
  return { ...rest, ...(execution ? { execution } : {}), outcomeProvenance: 'user_annotation', configurationProvenance: 'user_annotation', resourceProvenance: 'derived_ledger_snapshot', excluded: !!excludedReason, configuration: configuration ? { ...configuration, uncontrolledFactors: include ? configuration.uncontrolledFactors.map(redactText) : [], uncontrolledFactorCount: configuration.uncontrolledFactors.length } : null,
    ...(include ? { environment: redactText(environment), excludedReason: excludedReason ? redactText(excludedReason) : null } : { taskNotes: 'omitted_by_policy' }) };
}
function outcomes(store: InspectorStore, query: InspectorQuery): TrialRecord[] {
  const threads = query.runId || query.agentId ? new Set([query.agentId ?? query.runId, ...store.sources({ runId: query.runId, agentId: query.agentId, agentMode: query.agentMode, machineId: query.machineId }).map(source => source.threadId)]) : null;
  const rows: TrialRecord[] = [];
  for (const row of store.db.prepare('SELECT record FROM trials WHERE workspace_id=? ORDER BY rowid').iterate(store.workspaceId)) {
    const trial = JSON.parse(String(row.record)) as TrialRecord;
    if (threads && !threads.has(trial.runId) || query.machineId && trial.machineId !== query.machineId) continue;
    if (!withinDates(trial.resources?.observedFrom ?? null, query) || !withinDates(trial.resources?.observedTo ?? null, query)) continue;
    if (query.requestedModel && (!trial.resources?.requestedModels.length || trial.resources.requestedModels.some(model => model !== query.requestedModel))) continue;
    if (query.projectId && (!trial.resources?.projectIds.length || trial.resources.projectIds.some(project => project !== query.projectId))) continue;
    if (query.attributedModel && (!trial.resources?.observedModels?.length || trial.resources.observedModels.some(model => model !== query.attributedModel))) continue;
    if (query.provider !== undefined && (!trial.resources?.providers?.length || trial.resources.providers.some(provider => provider !== query.provider))) continue;
    if (query.serviceTier !== undefined && (!trial.resources?.serviceTiers?.length || trial.resources.serviceTiers.some(tier => tier !== query.serviceTier))) continue;
    if (query.agentId && (!trial.resources?.agentIds?.length || trial.resources.agentIds.some(id => !threads?.has(id)))) continue;
    rows.push(trial); if (rows.length > 10000) throw new Error('REPORT_TOO_LARGE');
  }
  return rows;
}

export function report(store: InspectorStore, queryValue: unknown, format: unknown, optionsValue?: unknown): { body: string; format: string; revision: number; projectIds: string[]; privacyVersion: string } {
  if (!['markdown', 'json', 'csv'].includes(String(format))) throw new Error('INVALID_FORMAT');
  const selection = options(optionsValue); const includeNotes = selection.includeTaskNotes === true;
  const query = validateQuery(queryValue); delete query.cursor; query.limit = 200;
  if (selection.table === 'detector-evaluation') {
    if (selection.contractId || includeNotes) throw new Error('INVALID_REPORT_OPTIONS');
    const base = {kind:'detector-evaluation',scope:'synthetic_build_corpus',...detectorResults,limitations:['Small synthetic labeled corpus; not production accuracy, human-reviewed private traces, proven waste or measured savings.','One case / target detector is one scoring unit. Unsupported capability cases remain unscored.','Scope filters do not change this build-level evaluation; no user records are included.']};
    let body:string;
    if(format==='json')body=JSON.stringify(clean(base),null,2);
    else if(format==='csv') {
      const header=['detector','level','cases','TP','FP','FN','TN','unscored','precision','recall','corpus_id','source_digest','synthetic','labeling_policy'];
      const rows=detectorResults.detectors.flatMap(row=>(['pattern','candidate'] as const).map(level=>{const v=row[level];return[row.id,level,String(row.cases),String(v.truePositive),String(v.falsePositive),String(v.falseNegative),String(v.trueNegative),String(v.unscored),v.precision===null?'':String(v.precision),v.recall===null?'':String(v.recall),detectorResults.corpusId,detectorResults.sourceDigest,'true',detectorResults.labelingPolicy];}));
      body=[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
    }else body=['# Detector fixture evaluation / 偵測器測例評估','',`${base.caseCount} synthetic cases; not production accuracy or measured savings.`,base.labelingPolicy,'','```json',JSON.stringify(clean(base),null,2),'```',''].join('\n');
    return {body,format:String(format),revision:store.revision(),projectIds:[],privacyVersion:privacyVersion(store)};
  }
  const projectIds = new Set(selection.contractId ? [] : reportProjects(store, query)); assertProjectExports(store, projectIds);
  const privacyStamp = privacyVersion(store);
  if (selection.table === 'tool-activity') {
    if (selection.contractId || includeNotes) throw new Error('INVALID_REPORT_OPTIONS');
    const activity = toolActivity(store, query);
    const limitations = ['Captured output only, not original log size, model input, argument-generation tokens or a dollar cost.', 'Recorded argument bytes and approximate text tokens are separate from captured output; neither proves official generated tokens or subsequent request inclusion. Conflicted calls/outputs are excluded; missing measurements remain unknown.', 'Repeated captured payload within the same tool/operation group does not establish waste, later request inclusion, cache allocation or savings.', 'Counts cover every scoped tool identity, not a proven cross-source deduplicated execution population; groups are ranked and capped at 20; evidence references are capped at 5 per group. Durations sum timed operations, not elapsed task time.'];
    const base = { schemaVersion: '1', kind: 'tool-activity', scope: query, adapterVersion: ADAPTER_VERSION, policyVersion: POLICY_VERSION, estimatorVersion: 'approx-utf8-bytes-div4/1', redactionPolicyId: 'tool-activity-metadata-v1', ...activity, limitations };
    let body: string;
    if (format === 'json') body = JSON.stringify(clean(base), null, 2);
    else if (format === 'csv') {
      const fields = ['kind','tool','operation','ledger_revision','observation_revision','group_count','group_limit','adapter_version','policy_version','estimator_version','tool_identity_version','records','invocations','unpaired','failed','conflicted','measuredArguments','argumentBytes','measuredArgumentEstimates','argumentEstimate','outputs','measuredOutputs','outputBytes','measuredEstimates','payloadEstimate','partialOutputs','unknownCaptureOutputs','comparableOutputs','repeatedOutputRecords','repeatedOutputBytes','measuredDurations','durationMs','evidence_refs','limitations'];
      const countFields = fields.slice(11,-2);
      const records = [{ kind: 'aggregate', tool: '', operation: '', ...activity.totals, evidence_refs: '' }, ...activity.groups.map(({name,evidenceRefs,...group})=>({kind:'group',tool:name,...group,evidence_refs:evidenceRefs.join(';')}))];
      const rows = records.map(record => [record.kind,record.tool,record.operation,String(activity.revision),String(activity.observationRevision),String(activity.groupCount),String(activity.groupLimit),ADAPTER_VERSION,POLICY_VERSION,'approx-utf8-bytes-div4/1',activity.toolIdentityVersion,...countFields.map(field => String((record as unknown as Record<string,unknown>)[field] ?? '')),record.evidence_refs,limitations.join('; ')]);
      body = [fields,...rows].map(row => row.map(value => csvCell(redactText(value))).join(',')).join('\r\n') + '\r\n';
    } else body = ['# Tool activity / 工具操作彙總','',`Ledger revision: ${activity.revision}; observation watermark: ${activity.observationRevision}. Adapter: ${ADAPTER_VERSION}; policy: ${POLICY_VERSION}.`,'','```json',JSON.stringify(clean(base),null,2),'```',''].join('\n');
    return { body, format: String(format), revision: activity.revision, projectIds: [...projectIds], privacyVersion: privacyStamp };
  }
  if (selection.table === 'advice-plan') {
    if (format === 'csv' || selection.contractId || includeNotes) throw new Error('INVALID_REPORT_OPTIONS');
    const diagnostics = analyze(store, query); const finding = diagnostics.findings.find(item => item.id === selection.findingId);
    if (!finding?.plan) throw new Error('FINDING_NOT_IN_SCOPE');
    const plan = finding.plan; const base = { schemaVersion: '1', kind: 'advice-plan', revision: diagnostics.revision, scope: query, adapterVersion: ADAPTER_VERSION, policyVersion: POLICY_VERSION,
      redactionPolicyId: 'metadata-advice-v1', finding, evidence: finding.evidenceRefs.map(id => ({ id, availability: store.evidencePointer(id) ? 'retained_metadata_raw_not_rechecked' : 'not_retained' })),
      limitations: ['Only retained scoped detector candidates are included; evidence references can be capped.', 'Associated usage and duplicate emitted payload are not causal cost or measured savings.', 'Plan instructions are local deterministic templates, not trace-provided executable commands. No task is executed.'] };
    const body = format === 'json' ? JSON.stringify(clean(base),null,2) : ['# Bounded validation plan / 有界驗證方案', '', `Finding: ${finding.id}; ${finding.detectorId}/${finding.detectorVersion}; ledger revision ${diagnostics.revision}; plan ${plan.version}; state ${plan.state}.`,
      `Adapter: ${ADAPTER_VERSION}; policy: ${POLICY_VERSION}. Scope: ${JSON.stringify(clean(query))}.`, '', '## Observed / 觀察', ...finding.observedFacts.map(value => `- ${markdown(value)}`),
      '## Hypotheses and alternatives / 假設及其他解釋', ...[...finding.hypotheses,...finding.alternativeExplanations].map(value => `- ${markdown(value)}`),
      ...[['Bounded change / 改動範圍',plan.boundedChange],['Preserve / 保留條件',plan.preserve],['Compare / 驗收及比較',plan.comparison],['Rollback / 回退條件',plan.rollback]].flatMap(([title,value]) => ['',`## ${title}`,markdown((value as typeof plan.boundedChange).zh),markdown((value as typeof plan.boundedChange).en)]),
      '', `Quality risk: ${markdown(finding.qualityRisk)}. Expected token/USD savings: unknown / 未量測。`, `Associated tokens (not causal): ${finding.associatedUsage.value ?? 'unknown'}.`,
      `Annotation: ${finding.annotation ?? 'none'}; suppressions: ${finding.suppressionReasons.map(markdown).join('; ') || 'none'}.`, '', '## Evidence / 證據', ...base.evidence.map(item => `- ${item.id}: ${item.availability}.`), '', ...base.limitations.map(markdown), ''].join('\n');
    return { body, format: String(format), revision: diagnostics.revision, projectIds: [...projectIds], privacyVersion: privacyStamp };
  }
  if (selection.table === 'data-quality') {
    if (format === 'csv') throw new Error('INVALID_FORMAT');
    if (selection.contractId || includeNotes) throw new Error('INVALID_REPORT_OPTIONS');
    const quality = dataQuality(store, query);
    const base = { schemaVersion: '1', kind: 'data-quality', adapterVersion: ADAPTER_VERSION, policyVersion: POLICY_VERSION, redactionPolicyId: 'diagnostic-metadata-v1', ...quality };
    const body = format === 'json' ? JSON.stringify(clean(base), null, 2) :
      ['# Token Inspector data quality', '', `Ledger revision: ${quality.revision}. Measured at: ${quality.measuredAt}.`, '', '## Counts and boundaries', '', '```json', JSON.stringify(clean(base), null, 2), '```', ''].join('\n');
    return { body, format: String(format), revision: quality.revision, projectIds: [...projectIds], privacyVersion: privacyStamp };
  }
  const experiment = selection.contractId ? experiments(store, selection.contractId, 10000) : null;
  if (experiment && !experiment.contracts.length) throw new Error('UNKNOWN_CONTRACT');
  if (experiment?.truncated) throw new Error('REPORT_POPULATION_LIMIT');
  const revision = store.revision(); const summary = experiment ? null : store.summary(query); const entries: LedgerEntry[] = [];
  if (!experiment) {
    const filter = store.queryFilter(query, 'l');
    const rows = store.db.prepare(`SELECT l.entry FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision
      WHERE ${filter.sql} ORDER BY l.id LIMIT 10001`);
    for (const row of rows.iterate(...filter.args)) entries.push(JSON.parse(String(row.entry)) as LedgerEntry);
    if (entries.length > 10000) throw new Error('REPORT_TOO_LARGE');
  }
  const diagnostics = experiment ? null : analyze(store, query);
  const comparison = experiment ? null : agentComparison(store, { query });
  const context = experiment ? null : contextAttribution(store, { query });
  const trials = experiment?.trials ?? outcomes(store, query);
  for (const trial of trials) for (const id of trial.resources?.projectIds.length ? trial.resources.projectIds : ['(unknown)']) projectIds.add(id);
  assertProjectExports(store, projectIds);
  const contractIds = new Set(trials.map(trial => trial.contractId));
  const contracts = experiment?.contracts ?? [...contractIds].map(id => {
    const row = store.db.prepare('SELECT record FROM task_contracts WHERE workspace_id=? AND id=?').get(store.workspaceId, id);
    return row ? JSON.parse(String(row.record)) as TaskContract : null;
  }).filter((value): value is TaskContract => value !== null);
  const refs = [...new Set([...entries.flatMap(entry => entry.evidenceRefs), ...trials.flatMap(trial => trial.evidenceRefs), ...(diagnostics?.findings.flatMap(finding => finding.evidenceRefs) ?? []), ...(comparison?.shared.flatMap(group => group.evidenceRefs) ?? []), ...(comparison?.handoffs.map(item => item.evidenceRef) ?? [])])];
  if (refs.length > 20000) throw new Error('REPORT_TOO_LARGE');
  const referencedSources = new Set<string>();
  const evidence = refs.map(id => { const pointer = store.evidencePointer(id); if (pointer) referencedSources.add(pointer.cursor.id); return { id, availability: !pointer ? 'not_retained' : pointer.cursor.path.startsWith('remote:') ? 'remote_metadata_only' : 'indexed_reference_raw_not_rechecked' }; });
  const table = selection.table ?? (experiment ? 'trials' : 'ledger'); if (experiment && !['trials', 'paired-trials'].includes(table)) throw new Error('INVALID_REPORT_TABLE');
  const trialRows = trials.map(trial => trialView(trial, includeNotes));
  const trialsById = new Map(trials.map(trial => [trial.id, trial]));
  const pairedModels = (ids: string[], field: 'requestedModels' | 'observedModels') => [...new Set(ids.flatMap(id => trialsById.get(id)?.resources?.[field] ?? []))].join(';');
  const paired = selection.pairedComparison ? pairedComparison(contracts[0], trials, selection.pairedComparison, experiment?.truncated) : null;
  if (paired && !paired.available) throw new Error('PAIRED_COMPARISON_UNAVAILABLE');
  const base = { schemaVersion: '2', kind: experiment ? 'experiment' : 'analysis', generatedAtLedgerRevision: revision, adapterVersion: ADAPTER_VERSION, policyVersion: POLICY_VERSION,
    scope: experiment ? { contractId: selection.contractId, measurement: 'immutable_trial_snapshots' } : query, createdAt: new Date().toISOString(), redactionPolicyId: includeNotes ? 'metadata-and-user-notes-v2' : 'metadata-report-v2',
    summary, entries, analytics: experiment ? null : store.analytics(query), prices: experiment ? null : priceAnalytics(store, query, 'historical'), manualUsdEstimate: experiment ? null : manualUsd(store, query),
    diagnostics, agentComparison: comparison, contextAttribution: context ? { providerInput: context.providerInput, passiveOccurrences: context.passiveOccurrences, passive: context.passive, items: context.items, lineage: context.lineage, requests: context.requests.items.map(({ manifest, ...entry }) => ({ ...entry, manifest: { schema: manifest.schema, clientId: manifest.clientId, requestId: manifest.requestId, machineId: manifest.machineId, threadId: manifest.threadId, turnId: manifest.turnId, capturedAt: manifest.capturedAt, contextEpoch: manifest.contextEpoch ?? null, items: manifest.items } })), requestPageLimited: !!context.requests.nextCursor, occurrencePageLimited: !!context.nextCursor, notes: context.notes } : null, incidents: experiment ? null : incidents(store, query), contracts: contracts.map(contract => contractView(contract, includeNotes)), outcomes: trialRows,
    experiment: experiment ? { variants: experiment.variants, recommendations: experiment.recommendations, completePopulation: true, notes: experiment.notes, ...(paired ? { pairedComparison: paired } : {}) } : null,
    sources: experiment ? [] : store.sources(query).filter(source => {
      if (!query.requestedModel && !query.projectId || referencedSources.has(source.id)) return true;
      const context = store.getSource(source.id)?.context;
      return (!query.requestedModel || context?.requestedModel === query.requestedModel) && (!query.projectId || context?.projectId === query.projectId);
    }).map(({ label: _label, ...source }) => source), evidence,
    limits: { maxLedgerEntries: 10000, maxTrialRecords: 10000, maxEvidenceReferences: 20000, analyticsGroupLimit: 30, analyticsDayBucketLimit: 366, toolPageOnly: !!diagnostics?.nextToolsCursor, findingsMayBeLimited: (diagnostics?.findings.length ?? 0) >= 200, compactionRecordsMayBeLimited: (diagnostics?.compactionCount ?? 0) > (diagnostics?.compactions.length ?? 0) },
    privacy: 'No raw Codex prompts, tool arguments/results, code, paths, credentials or content fingerprints are included. Optional notes are user-authored task annotations, with common secret patterns redacted.',
    limitations: ['Trial resources retain their own import-time ledger revisions and are not added to the live-ledger totals.',
      'Analysis outcomes include only whole imported trials proven inside the requested scope. Legacy trial snapshots without required provider/tier/agent/model fields are excluded by those filters rather than partially repriced. Experiment reports include every stored attempt for the selected contract, including failures, cancellations and exclusions.',
      'Raw source text was not reread for this export. Evidence availability describes retained index references, not verified current file contents.',
      'Tool payload estimates and associated findings are not measured provider savings. API-equivalent prices are not subscription charges.',
      'Machine source timestamps do not establish cross-machine causal order. Requested-model attribution is not proof of actual routing.',
      ...(includeNotes ? ['User-authored notes are included by explicit selection; review them before sharing. Pattern redaction cannot identify every secret.'] : ['Free-text task definitions, environment descriptions, exclusion reasons and uncontrolled-factor notes are omitted by default.'])] };
  if (format === 'json') return { body: JSON.stringify(clean(base), null, 2), format, revision, projectIds: [...projectIds], privacyVersion: privacyStamp };
  if (format === 'csv') {
    let fields: string[]; let rows: string[][];
    if (table === 'paired-trials' && paired) {
      fields = ['contract_id', 'reference_variant', 'candidate_variant', 'pair_id', 'reference_trial_ids', 'candidate_trial_ids', 'both_accepted', 'issues', 'reference_ledger_revisions', 'candidate_ledger_revisions', 'reference_price_snapshot_ids', 'candidate_price_snapshot_ids', 'comparison_version', 'report_adapter_version', 'report_policy_version', 'reference_requested_models', 'candidate_requested_models', 'reference_observed_models', 'candidate_observed_models', 'resource', 'unit', 'reference_value', 'candidate_value', 'candidate_minus_reference'];
      rows = paired.pairs.flatMap(pair => { const models = [pairedModels(pair.referenceIds, 'requestedModels'), pairedModels(pair.candidateIds, 'requestedModels'), pairedModels(pair.referenceIds, 'observedModels'), pairedModels(pair.candidateIds, 'observedModels')]; return pair.metrics.map(metric => [paired.contractId, paired.selection.referenceVariant, paired.selection.candidateVariant, pair.pairId ?? '', pair.referenceIds.join(';'), pair.candidateIds.join(';'), String(pair.accepted), [...paired.issues, ...pair.issues].join(';'), pair.referenceRevisions.join(';'), pair.candidateRevisions.join(';'), pair.referencePriceIds.join(';'), pair.candidatePriceIds.join(';'), paired.version, ADAPTER_VERSION, POLICY_VERSION, ...models, metric.key, metric.unit, metric.reference ?? '', metric.candidate ?? '', metric.delta ?? '']); });
    } else if (table === 'ledger') {
      fields = ['entry_id', 'revision', 'grain', 'thread_id', 'requested_model', 'observed_model', 'input', 'cached_input_included', 'output', 'reasoning_included', 'total', 'state', 'issues'];
      rows = entries.map(entry => [entry.id, String(entry.revision), entry.grain, entry.identity.threadId ?? '', entry.model.requestedModel ?? '', entry.model.observedModel ?? '', entry.usage.input.value ?? '', entry.usage.cachedInput.value ?? '', entry.usage.output.value ?? '', entry.usage.reasoningOutput.value ?? '', entry.usage.total.value ?? '', entry.selectionStatus, entry.issues.join(';')]);
    } else if (table === 'context-origins') {
      fields = ['primary_origin', 'source_occurrences', 'captured_bytes', 'known_payload_estimate_not_model_input', 'unestimated_occurrences'];
      rows = (context?.passive ?? []).map(category => [category.origin, String(category.occurrences), category.bytes ?? '', category.estimate.value ?? '', String(category.unknownEstimates)]);
    } else if (table === 'agent-comparison') {
      fields = ['group_id', 'left_agent_id', 'right_agent_id', 'classification', 'annotation', 'recorded_calls', 'output_bytes', 'complete_capture', 'target_expression_match', 'source_overlap_ms', 'associated_tokens_not_causal', 'avoidable_tokens', 'evidence_refs'];
      rows = (comparison?.shared ?? []).map(group => [group.id, comparison!.leftAgentId ?? '', comparison!.rightAgentId ?? '', group.classification, group.annotation ?? '', String(group.invocations), group.outputBytes, String(group.completeCapture), group.commonTarget === null ? '' : String(group.commonTarget), group.overlapMs === null ? '' : String(group.overlapMs), group.associatedUsage.value ?? '', group.avoidableUsage.value ?? '', group.evidenceRefs.join(';')]);
    } else if (table === 'findings') {
      fields = ['finding_id', 'detector', 'confidence', 'annotation', 'facts', 'hypotheses', 'alternatives', 'recommendations', 'quality_risk', 'validation', 'associated_tokens_not_causal', 'avoidable_tokens', 'evidence_refs', 'plan_version', 'plan_state', 'bounded_change', 'preserve', 'comparison', 'rollback', 'expected_impact'];
      rows = (diagnostics?.findings ?? []).map(finding => [finding.id, `${finding.detectorId}/${finding.detectorVersion}`, finding.confidence, finding.annotation ?? '', finding.observedFacts.join('; '), finding.hypotheses.join('; '), finding.alternativeExplanations.join('; '), finding.recommendations.join('; '), finding.qualityRisk, finding.validation, finding.associatedUsage.value ?? '', finding.avoidableTokens.value ?? '', finding.evidenceRefs.join(';'), finding.plan?.version ?? '', finding.plan?.state ?? '', finding.plan?.boundedChange.en ?? '', finding.plan?.preserve.en ?? '', finding.plan?.comparison.en ?? '', finding.plan?.rollback.en ?? '', finding.plan?.impact ?? 'unknown']);
    } else {
      fields = ['trial_id', 'contract_id', 'run_id', 'machine_id', 'variant', 'outcome', 'reviewed', 'excluded', 'ledger_revision', 'total_tokens', 'known_token_subtotal', 'uncached_input', 'observed_span_ms', 'failed_tools', 'retry_candidates', 'compaction_records', 'compaction_operations', 'order', 'pair_id', 'rerun_of', 'telemetry_issues', 'recorded_tool_union_ms', 'tool_intervals_indexed', 'tool_intervals_timed', 'tool_intervals_missing', 'tool_intervals_invalid', 'tool_intervals_complete', 'tool_intervals_clock_scope'];
      rows = trials.map(trial => [trial.id, trial.contractId, trial.runId ?? '', trial.machineId ?? '', trial.variant, trial.outcome, String(trial.acceptanceReviewed), String(!!trial.excludedReason), String(trial.revision), trial.tokens ?? '', trial.resources?.knownTokens ?? '', trial.resources?.uncachedInput ?? '', trial.resources?.observedWindowMs ?? '', trial.resources?.failedToolCalls?.toString() ?? '', trial.resources?.retryCandidates?.toString() ?? '', trial.resources?.compactionRecords?.toString() ?? '', trial.resources?.compactionOperations?.toString() ?? '', trial.configuration?.order.toString() ?? '', trial.configuration?.pairId ?? '', trial.configuration?.rerunOf ?? '', trial.resources?.issues.join(';') ?? '', trial.resources?.toolIntervals?.knownUnionMs ?? '', trial.resources?.toolIntervals?.indexedCalls.toString() ?? '', trial.resources?.toolIntervals?.timedCalls.toString() ?? '', trial.resources?.toolIntervals?.missingCalls.toString() ?? '', trial.resources?.toolIntervals?.invalidCalls.toString() ?? '', trial.resources?.toolIntervals?.recordedComplete.toString() ?? '', trial.resources?.toolIntervals?.clockScope ?? '']);
    }
    return { body: [fields, ...rows].map((row, index) => row.map((value, column) => table === 'paired-trials' && index > 0 && column >= fields.length - 3 && /^-?\d+(?:\.\d+)?$/.test(value) ? value : csvCell(redactText(value))).join(',')).join('\r\n') + '\r\n', format, revision, projectIds: [...projectIds], privacyVersion: privacyStamp };
  }
  const lines = [experiment ? '# Token Inspector experiment report' : '# Token Inspector analysis report', '', `Generated at ledger revision ${revision}. Adapter: ${ADAPTER_VERSION}. Policy: ${POLICY_VERSION}.`, '',
    ...(summary ? [`Selected ledger total: ${summary.usage.total.value ?? 'unknown'} tokens. Input: ${summary.usage.input.value ?? 'unknown'}; output: ${summary.usage.output.value ?? 'unknown'}.`,
      `Cache (included): ${summary.usage.cachedInput.value ?? 'unknown'}; reasoning (included): ${summary.usage.reasoningOutput.value ?? 'unknown'}.`, '', '## Coverage and freshness', '', ...summary.coverageNotes.map(note => `- ${markdown(note)}`),
      ...base.sources.map(source => `- ${markdown(source.id)} · ${markdown(source.machineId)}: ${source.state}, ${source.bytesProcessed}/${source.fileBytes ?? 'unknown'} bytes; last seen ${markdown(source.lastSeenAt)}; ${source.issues.map(markdown).join(', ') || 'no recorded source issue'}.`)] : []),
    ...(base.prices ? ['', '## API-equivalent price coverage', '', ...base.prices.currencies.map(price => `- ${price.currency} ${price.amount}; ${price.pricedEntries} priced ledger entries; token subtotal ${price.tokenSubtotal}.`), `- ${base.prices.unpricedEntries} entries unpriced; currencies are not combined.`, ...base.prices.reasons.map(reason => `- ${reason.entries}: ${markdown(reason.reason)}.`)] : []),
    ...(base.manualUsdEstimate?.price ? ['', '## USD scenario', '', `Known subtotal range: USD ${base.manualUsdEstimate.amount ?? 'unknown'} to ${base.manualUsdEstimate.upperAmount ?? 'unknown'}; priced entries ${base.manualUsdEstimate.pricedEntries}; unpriced ${base.manualUsdEstimate.unpricedEntries}.`, `Price ID: ${base.manualUsdEstimate.price.id}; mode ${base.manualUsdEstimate.price.mode}; price snapshot date ${base.manualUsdEstimate.price.createdAt}.`,
      ...(base.manualUsdEstimate.price.catalog?.map(card => `- ${card.model}: input/cache-read/cache-write/output USD per million ${card.inputRate}/${card.cachedInputRate}/${card.cacheWriteRate}/${card.outputRate}; >272000 response input multiplies input/cache rates by 2, output by 1.5; service multipliers ${JSON.stringify(card.serviceMultipliers)}. Source: ${card.sourceUrl}.`) ?? [`Uniform/input/cache/output USD per million: ${base.manualUsdEstimate.price.uniformRate ?? '-'}/${base.manualUsdEstimate.price.inputRate ?? '-'}/${base.manualUsdEstimate.price.cachedInputRate ?? '-'}/${base.manualUsdEstimate.price.outputRate ?? '-'}.`]),
      ...base.manualUsdEstimate.assumptions.map(item => `- Assumption ${item.assumption}: ${item.entries} entries.`), ...base.manualUsdEstimate.reasons.map(item => `- Unpriced ${item.reason}: ${item.entries} entries.`), ...base.manualUsdEstimate.notes] : []),
    '', '## Persistent incidents', '', ...(base.incidents?.items.map(incident => `- ${markdown(incident.id)}: ${incident.detectorId}; matches ${incident.occurrences}; record revision ${incident.revision}; controlled alerts ${incident.updates}; historical ${incident.historical}; annotation ${incident.annotation ?? 'none'}; latest evidence time ${markdown(incident.lastObservedAt ?? 'unknown')}.`) ?? []),
    '', '## Task contracts', '', ...contracts.flatMap(contract => [`- ${markdown(contract.id)} · revision ${contract.revision}; suite ${markdown(contract.protocol?.suiteId ?? 'not recorded')}.`, ...(contract.protocol ? [`  Frozen inputs: ${markdown(contract.protocol.datasetRevision)}; repository: ${markdown(contract.protocol.repositoryRevision)}; acceptance suite: ${markdown(contract.protocol.acceptanceSuite)}; changed variables: ${contract.protocol.changedVariables.join(', ')}; order: ${contract.protocol.ordering}; minimum trials: ${contract.protocol.minimumTrials}.`] : []), ...(includeNotes ? [`  Objective: ${markdown(contract.objective)}. Acceptance: ${markdown(contract.acceptance)}. Permitted scope: ${markdown(contract.permittedScope ?? "not recorded")}. Environment: ${markdown(contract.environment)}.`] : ['  Free-text task notes omitted by policy.'])]),
    '', '## Retry and diagnostic progress', '', ...((diagnostics?.retries.episodes ?? []).map(episode => `- ${episode.id}: ${episode.status}; ${episode.attemptCount} distinct attempts, ${episode.failures} observed failures, ${episode.polls} linked polls, ${episode.edits} recorded edits, ${episode.failureChanges} changed signatures; linked response subtotal ${episode.associatedUsage.value ?? 'unknown'} tokens. Not causal retry cost, task acceptance or measured savings.`)),
    '', '## Context attribution', '', `Recorded model input: ${context?.providerInput.value ?? 'unknown'} tokens. Source occurrences: ${context?.passiveOccurrences ?? 'unknown'}. Source estimates are not reconstructed request input.`,
    ...(context?.passive ?? []).map(category => `- ${category.origin}: ${category.occurrences} source occurrences; ${category.bytes ?? 'unknown'} captured bytes; ${category.estimate.value ?? 'unknown'} approximate payload tokens; ${category.unknownEstimates} unestimated occurrences.`),
    ...(context?.requests.items ?? []).map(request => `- Client request ${markdown(request.manifest.clientId)}/${markdown(request.manifest.requestId)}: ${request.linkage}; ${request.reconstructionState}; visible estimate ${request.visibleEstimate.value ?? 'unknown'}; recorded input ${request.observedInput.value ?? 'unknown'}; difference ${request.discrepancy ?? 'unknown'}. Difference is not hidden context or savings.`),
    '', '## Cross-agent comparison', '', `Selected pair: ${comparison?.leftAgentId ?? 'unknown'} / ${comparison?.rightAgentId ?? 'unknown'}. Linked response union subtotal: ${comparison?.associatedUnionUsage.value ?? 'unknown'} tokens; not causal or avoidable usage.`,
    ...(comparison?.shared ?? []).map(group => `- ${group.id}: ${group.classification}; annotation ${group.annotation ?? 'none'}; ${group.invocations} distinct recorded calls, ${group.outputBytes} captured bytes; complete capture ${group.completeCapture}; target-expression match ${group.commonTarget ?? 'unknown'}; source-time overlap ${group.overlapMs ?? 'unknown'} ms; associated tokens ${group.associatedUsage.value ?? 'unknown'}; avoidable tokens unknown.`),
    ...(comparison?.notes ?? []).map(note => `- ${markdown(note)}`),
    '', '## Findings and recommendations', '', ...(diagnostics?.findings.length ? diagnostics.findings.flatMap(finding => [`### ${markdown(finding.title)}`, `Confidence: ${finding.confidence}; annotation: ${finding.annotation ?? 'none'}.`,
      `Observed: ${finding.observedFacts.map(markdown).join(' ')}`, `Hypotheses: ${finding.hypotheses.map(markdown).join(' ')}`, `Alternatives: ${finding.alternativeExplanations.map(markdown).join(' ')}`,
      `Suggestion: ${finding.recommendations.map(markdown).join(' ')}`, `Quality risk: ${markdown(finding.qualityRisk)}. Validation: ${markdown(finding.validation)}`, ...(finding.plan ? [`Plan: ${finding.plan.version}; ${finding.plan.state}. Bounded change: ${markdown(finding.plan.boundedChange.en)}`, `Preserve: ${markdown(finding.plan.preserve.en)}. Compare: ${markdown(finding.plan.comparison.en)}`, `Rollback: ${markdown(finding.plan.rollback.en)}. Expected token/USD impact: unknown.`] : []), `Avoidable tokens: ${finding.avoidableTokens.value ?? 'unknown'}. Evidence: ${finding.evidenceRefs.map(markdown).join(', ')}.`, '']) : ['No qualifying findings in this report scope; this does not establish complete behavioral coverage.']),
    '', '## Trial outcomes and resources', '', ...trials.flatMap(trial => [`- ${markdown(trial.id)} · ${markdown(trial.variant)} · ${trial.outcome}; reviewed ${trial.acceptanceReviewed}; excluded ${!!trial.excludedReason}; snapshot revision ${trial.revision}.`,
      `  Tokens ${trial.tokens ?? 'unknown'} (known subtotal ${trial.resources?.knownTokens ?? 'unknown'}); uncached input ${trial.resources?.uncachedInput ?? 'unknown'}; observed span ${trial.resources?.observedWindowMs ?? 'unknown'} ms; failed tools ${trial.resources?.failedToolCalls ?? 'unknown'}; retry candidates ${trial.resources?.retryCandidates ?? 'unknown'}; legacy compaction markers ${trial.resources?.compactionRecords ?? 'unknown'}; completed compaction operation groups ${trial.resources?.compactionOperations ?? 'unknown'}.`,
      `  API-equivalent estimates: ${trial.resources?.prices.map(price => `${price.currency} ${price.amount}`).join(', ') || 'unpriced'}; unpriced entries ${trial.resources?.unpricedEntries ?? 'unknown'}.`,
      `  Recorded tool interval union: ${trial.resources?.toolIntervals?.knownUnionMs ?? 'unknown'} ms; timed/indexed ${trial.resources?.toolIntervals?.timedCalls ?? 'unknown'}/${trial.resources?.toolIntervals?.indexedCalls ?? 'unknown'}; missing/invalid ${trial.resources?.toolIntervals?.missingCalls ?? 'unknown'}/${trial.resources?.toolIntervals?.invalidCalls ?? 'unknown'}; indexed timing complete ${trial.resources?.toolIntervals?.recordedComplete ?? 'unknown'}; clock scope ${trial.resources?.toolIntervals?.clockScope ?? 'unknown'}. This is not CPU, full task, background process or waiting time.`,
      ...(trial.configuration ? [`  Declared model/configuration: ${markdown(trial.configuration.model)}/${markdown(trial.configuration.configuration)}; input/repository: ${markdown(trial.configuration.datasetRevision)}/${markdown(trial.configuration.repositoryRevision)}; execution order: ${trial.configuration.order}; pair: ${markdown(trial.configuration.pairId ?? 'unpaired')}; rerun of: ${markdown(trial.configuration.rerunOf ?? 'none')}.`] : []),
      `  Uncontrolled factors: ${includeNotes ? trial.configuration?.uncontrolledFactors.map(markdown).join('; ') || 'not recorded' : `${trial.configuration?.uncontrolledFactors.length ?? 0} notes omitted by policy`}.`]),
    ...(experiment ? ['', '## Experiment distributions and conclusions', '', ...experiment.variants.map(variant => `- ${markdown(variant.variant)}: accepted ${variant.accepted}/${variant.trials}; failed/cancelled ${variant.failedOrCancelled}; all tokens ${variant.totalTokens ?? 'unknown'}; token min/median/max ${variant.distributions.tokens.minimum ?? 'unknown'}/${variant.distributions.tokens.median ?? 'unknown'}/${variant.distributions.tokens.maximum ?? 'unknown'}; missing ${variant.distributions.tokens.missing}; eligibility ${variant.eligible}; ${variant.reasons.map(markdown).join(', ')}.`),
      ...experiment.variants.flatMap(variant => [
        ...Object.entries(variant.distributions).map(([name, values]) => `- ${markdown(variant.variant)} · ${name}: min/median/max ${values.minimum ?? 'unknown'}/${values.median ?? 'unknown'}/${values.maximum ?? 'unknown'}; known ${values.count}; missing ${values.missing}.`),
        ...variant.priceDistributions.map(price => `- ${markdown(variant.variant)} · API-equivalent ${price.currency}: min/median/max ${price.amounts.minimum ?? 'unknown'}/${price.amounts.median ?? 'unknown'}/${price.amounts.maximum ?? 'unknown'}; known ${price.amounts.count}; missing ${price.amounts.missing}.`),
      ]),
      ...experiment.recommendations.map(item => `- Exploratory candidate by median accepted tokens: ${item.variant ? markdown(item.variant) : 'none'}. ${item.reasons.map(markdown).join(', ')}.`), ...experiment.notes.map(note => `- ${markdown(note)}`)] : []),
    ...(paired ? ['', '## Paired trial differences', '', `Candidate ${markdown(paired.selection.candidateVariant)} minus reference ${markdown(paired.selection.referenceVariant)}. ${paired.selectedTrials} selected-variant trials; ${paired.acceptedPairs}/${paired.pairs.length} groups accepted on both sides.`,
      `Comparison version: ${paired.version}. Descriptive differences include measured failed/excluded trials. Unknown or duplicated pair members stay unknown. No causal savings or winner claim; price snapshots are retained per trial and currencies remain separate.`,
      ...paired.issues.map(issue => `- ${markdown(issue)}`),
      ...paired.summaries.map(metric => `- ${markdown(metric.key)} (${metric.unit}) differences: min/median/max ${metric.differences.minimum ?? 'unknown'}/${metric.differences.median ?? 'unknown'}/${metric.differences.maximum ?? 'unknown'}; known ${metric.differences.count}; missing ${metric.differences.missing}.`),
      ...paired.pairs.flatMap(pair => [`- Pair ${markdown(pair.pairId ?? 'unpaired')}: reference ${pair.referenceIds.map(markdown).join(', ') || 'missing'} (ledger ${pair.referenceRevisions.join(', ') || 'unknown'}; prices ${pair.referencePriceIds.map(markdown).join(', ') || 'unpriced'}); candidate ${pair.candidateIds.map(markdown).join(', ') || 'missing'} (ledger ${pair.candidateRevisions.join(', ') || 'unknown'}; prices ${pair.candidatePriceIds.map(markdown).join(', ') || 'unpriced'}); both accepted ${pair.accepted}; ${pair.issues.map(markdown).join(', ')}.`, ...pair.metrics.map(metric => `  ${markdown(metric.key)} (${metric.unit}): ${metric.reference ?? 'unknown'} → ${metric.candidate ?? 'unknown'}; difference ${metric.delta ?? 'unknown'}.`)])] : []),
    '', '## Ledger membership', '', ...entries.map(entry => `- ${markdown(entry.id)}: ${entry.grain}, ${entry.usage.total.value ?? 'unknown'} tokens, ${entry.selectionStatus}; evidence ${entry.evidenceRefs.map(markdown).join(', ')}.`),
    '', '## Evidence availability', '', ...evidence.map(item => `- ${markdown(item.id)}: ${item.availability}.`), '', '## Limits and privacy', '', ...base.limitations.map(note => `- ${markdown(note)}`),
    ...(base.limits.toolPageOnly ? ['- Tool metadata includes the first page only; findings/context are analyzed across the eligible scope.'] : []),
    ...(base.limits.findingsMayBeLimited ? ['- The findings limit was reached; this list may be incomplete.'] : []), ...(base.limits.compactionRecordsMayBeLimited ? ['- The compaction-record list may be limited.'] : []), '', base.privacy, ''];
  return { body: lines.join('\n'), format: 'markdown', revision, projectIds: [...projectIds], privacyVersion: privacyStamp };
}
