import { benchmarkExecutions } from './executions';
import { randomUUID } from 'node:crypto';
import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import { digest, object } from '../accounting/codex-observations';
import { trialResources } from './resources';
import { compareTrials } from './comparison';
import type { BenchmarkProtocol, ExperimentView, TaskContract, TrialConfiguration, TrialRecord } from '../shared/inspector';

function text(value: unknown, limit = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('INVALID_RECORD');
  return value.trim();
}
function identifier(value: unknown): string {
  const result = text(value, 128); if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result)) throw new Error('INVALID_PROTOCOL_IDENTIFIER'); return result;
}
function protocol(value: unknown): BenchmarkProtocol | null {
  if (value == null) return null;
  const input = object(value); if (!input || Object.keys(input).some(key => !['suiteId', 'datasetRevision', 'repositoryRevision', 'acceptanceSuite', 'changedVariables', 'ordering', 'minimumTrials'].includes(key))) throw new Error('INVALID_PROTOCOL');
  if (!Array.isArray(input.changedVariables) || !input.changedVariables.length || input.changedVariables.length > 5 || new Set(input.changedVariables).size !== input.changedVariables.length
    || input.changedVariables.some(item => !['instructions', 'tool_output', 'decomposition', 'model', 'configuration'].includes(String(item)))
    || !['paired', 'randomized', 'recorded'].includes(String(input.ordering)) || !Number.isInteger(input.minimumTrials) || Number(input.minimumTrials) < 3 || Number(input.minimumTrials) > 100) throw new Error('INVALID_PROTOCOL');
  return { suiteId: identifier(input.suiteId), datasetRevision: identifier(input.datasetRevision), repositoryRevision: identifier(input.repositoryRevision), acceptanceSuite: identifier(input.acceptanceSuite),
    changedVariables: input.changedVariables as BenchmarkProtocol['changedVariables'], ordering: input.ordering as BenchmarkProtocol['ordering'], minimumTrials: Number(input.minimumTrials) };
}
function configuration(value: unknown): TrialConfiguration | null {
  if (value == null) return null;
  const input = object(value); if (!input || Object.keys(input).some(key => !['datasetRevision', 'repositoryRevision', 'model', 'configuration', 'pairId', 'order', 'rerunOf', 'uncontrolledFactors'].includes(key))) throw new Error('INVALID_TRIAL_CONFIGURATION');
  if (!Number.isSafeInteger(input.order) || Number(input.order) < 1 || !Array.isArray(input.uncontrolledFactors) || input.uncontrolledFactors.length > 20) throw new Error('INVALID_TRIAL_CONFIGURATION');
  return { datasetRevision: identifier(input.datasetRevision), repositoryRevision: identifier(input.repositoryRevision), model: identifier(input.model), configuration: identifier(input.configuration),
    pairId: input.pairId == null ? null : identifier(input.pairId), order: Number(input.order), rerunOf: input.rerunOf == null ? null : text(input.rerunOf, 128), uncontrolledFactors: input.uncontrolledFactors.map(value => text(value, 500)) };
}

export function saveContract(store: InspectorStore, value: unknown): TaskContract {
  const input = object(value); if (!input || Object.keys(input).some(key => !['runId', 'objective', 'acceptance', 'environment', 'protocol', 'permittedScope'].includes(key))) throw new Error('INVALID_RECORD');
  const runId = text(input.runId, 1024);
  if (!store.sources({ runId }).length) throw new Error('UNKNOWN_RUN');
  const permittedScope = input.permittedScope == null || input.permittedScope === '' ? null : text(input.permittedScope);
  const record: TaskContract = { id: randomUUID(), runId, revision: 1, objective: text(input.objective), acceptance: text(input.acceptance), environment: text(input.environment), protocol: protocol(input.protocol), permittedScope, createdAt: new Date().toISOString() };
  store.db.prepare('INSERT INTO task_contracts VALUES(?,?,?,?)').run(record.id, store.workspaceId, runId, JSON.stringify(record));
  store.audit('task_contract.create', record.id); return record;
}

export function importTrial(store: InspectorStore, value: unknown): TrialRecord {
  const input = object(value); const allowed = ['id', 'contractId', 'contractRevision', 'runId', 'machineId', 'variant', 'outcome', 'acceptanceReviewed', 'evidenceRefs', 'environment', 'cacheCondition', 'excludedReason', 'configuration', 'executionId', 'artifactRefs'];
  if (!input || Object.keys(input).some(key => !allowed.includes(key))) throw new Error('INVALID_RECORD');
  const contractId = text(input.contractId, 128); const row = store.db.prepare('SELECT record FROM task_contracts WHERE workspace_id=? AND id=?').get(store.workspaceId, contractId);
  if (!row) throw new Error('UNKNOWN_CONTRACT'); const contract = JSON.parse(String(row.record)) as TaskContract;
  if (input.contractRevision !== contract.revision) throw new Error('CONTRACT_REVISION_CHANGED');
  const executionId = input.executionId == null ? null : text(input.executionId, 128);
  const execution = executionId ? benchmarkExecutions(store, contractId).find(item => item.id === executionId) : undefined;
  if (executionId && (!execution || execution.status === 'running' || execution.contractRevision !== contract.revision)) throw new Error('BENCHMARK_EVIDENCE_UNAVAILABLE');
  const artifactRefs = input.artifactRefs === undefined ? [] : input.artifactRefs;
  if (!Array.isArray(artifactRefs) || artifactRefs.length > 32 || artifactRefs.some(id => typeof id !== 'string' || !execution?.outputFiles.some(file => file.id === id))) throw new Error('INVALID_BENCHMARK_ARTIFACT');
  if (execution && input.runId != null) throw new Error('BENCHMARK_AND_CODEX_SCOPES_DISTINCT');
  if (execution && input.outcome === 'verified_success' && (execution.status !== 'completed' || execution.exitCode !== 0 || execution.issues.length)) throw new Error('BENCHMARK_EXECUTION_NOT_SUCCESSFUL');

  if (!['verified_success', 'verified_failure', 'partial', 'cancelled', 'unverified', 'setup_failed'].includes(String(input.outcome)) || typeof input.acceptanceReviewed !== 'boolean') throw new Error('INVALID_OUTCOME');
  const runId = input.runId == null ? null : text(input.runId, 1024);
  if (runId === null && !execution && !['setup_failed', 'cancelled', 'unverified'].includes(String(input.outcome))) throw new Error('RUN_REQUIRED');
  let machineId = input.machineId == null ? null : text(input.machineId, 128);
  if (runId) {
    const machines = [...new Set(store.sources({ runId }).map(source => source.machineId))];
    if (!machines.length) throw new Error('UNKNOWN_RUN');
    if (!machineId && machines.length > 1) throw new Error('MACHINE_SELECTION_REQUIRED');
    machineId ??= machines[0]; if (!machines.includes(machineId)) throw new Error('UNKNOWN_RUN_MACHINE');
  }
  const scope = runId ? { runId, machineId: machineId! } : null;
  const sources = scope ? store.sources(scope) : [];
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length > 100) throw new Error('INVALID_EVIDENCE');
  for (const ref of input.evidenceRefs) {
    const pointer = typeof ref === 'string' ? store.evidencePointer(ref) : null;
    if (!pointer || !sources.some(source => source.id === pointer.cursor.id)) throw new Error('EVIDENCE_OUTSIDE_TRIAL');
  }
  if ((input.outcome === 'verified_success' || input.outcome === 'verified_failure') && (!input.acceptanceReviewed || !input.evidenceRefs.length && !artifactRefs.length)) throw new Error('ACCEPTANCE_REVIEW_REQUIRED');
  if (!['observed', 'controlled', 'uncontrolled', 'unknown'].includes(String(input.cacheCondition))) throw new Error('INVALID_RECORD');
  const config = configuration(input.configuration);
  if (config?.rerunOf) {
    const previous = store.db.prepare('SELECT contract_id FROM trials WHERE workspace_id=? AND id=?').get(store.workspaceId, config.rerunOf);
    if (!previous || previous.contract_id !== contractId) throw new Error('INVALID_RERUN_REFERENCE');
  }
  const canonicalInput = { id: text(input.id, 128), contractId, contractRevision: contract.revision, runId, machineId, variant: text(input.variant, 256), outcome: input.outcome,
    acceptanceReviewed: input.acceptanceReviewed, evidenceRefs: [...new Set(input.evidenceRefs)], environment: text(input.environment), cacheCondition: input.cacheCondition, configuration: config,
    excludedReason: input.excludedReason == null ? null : text(input.excludedReason), ...(executionId ? { executionId, artifactRefs: [...new Set(artifactRefs)] } : {}) };
  const hash = digest(JSON.stringify(canonicalInput));
  const existing = store.db.prepare('SELECT digest,record FROM trials WHERE workspace_id=? AND id=?').get(store.workspaceId, canonicalInput.id);
  if (existing) { if (existing.digest !== hash) throw new Error('TRIAL_ID_CONFLICT'); return JSON.parse(String(existing.record)) as TrialRecord; }
  if (executionId) for (const row of store.db.prepare('SELECT record FROM trials WHERE workspace_id=?').iterate(store.workspaceId)) if ((JSON.parse(String(row.record)) as TrialRecord).executionId === executionId) throw new Error('BENCHMARK_EXECUTION_ALREADY_REVIEWED');
  if (runId) {
    const sourceIds = new Set(sources.map(source => source.id));
    for (const row of store.db.prepare('SELECT record FROM trials WHERE workspace_id=?').iterate(store.workspaceId)) {
      const previous = JSON.parse(String(row.record)) as TrialRecord;
      if (previous.runId === runId && (!previous.machineId || previous.machineId === machineId)) throw new Error('RUN_ALREADY_IMPORTED');
      const coveredSources = previous.resources?.sourceIds ?? (previous.runId ? store.sources({ runId: previous.runId, machineId: previous.machineId ?? undefined }).map(source => source.id) : []);
      if (coveredSources.some(id => sourceIds.has(id))) throw new Error('OVERLAPPING_TRIAL_SCOPE');
    }
  }
  const resources = trialResources(store, scope); if (execution) { resources.issues.push('LOCAL_ACCEPTANCE_EXECUTION_NO_MODEL_TELEMETRY'); const related = store.sources({ runId: contract.runId }); resources.sourceIds = related.map(source => source.id); resources.projectIds = [...new Set(related.map(source => store.getSource(source.id)?.context.projectId ?? '(unknown)'))]; } const summary = scope ? store.summary(scope) : null;
  if (config && resources.requestedModels.length && !resources.requestedModels.includes(config.model)) resources.issues.push('DECLARED_MODEL_MISMATCH');
  const record = { ...canonicalInput, createdAt: new Date().toISOString(), tokens: summary?.usage.total.value ?? null, revision: store.revision(), resources, ...(execution ? { execution } : {}) } as TrialRecord;
  store.db.prepare('INSERT INTO trials VALUES(?,?,?,?,?)').run(record.id, store.workspaceId, contractId, hash, JSON.stringify(record));
  store.audit('trial.import', record.id); return record;
}

export function experiments(store: InspectorStore, contractIdValue?: unknown, limit = 1000): ExperimentView {
  const contractId = contractIdValue == null ? null : text(contractIdValue, 128);
  const contracts = store.db.prepare(`SELECT record FROM task_contracts WHERE workspace_id=? ${contractId ? 'AND id=?' : ''} ORDER BY rowid DESC LIMIT 201`).all(store.workspaceId, ...(contractId ? [contractId] : [])).map(row => JSON.parse(String(row.record)) as TaskContract);
  const trials = store.db.prepare(`SELECT record FROM trials WHERE workspace_id=? ${contractId ? 'AND contract_id=?' : ''} ORDER BY rowid LIMIT ?`).all(store.workspaceId, ...(contractId ? [contractId] : []), limit + 1).map(row => JSON.parse(String(row.record)) as TrialRecord);
  const executions = benchmarkExecutions(store, contractId ?? undefined);
  for (const execution of executions) if (!trials.some(trial => trial.executionId === execution.id)) {
    const resources = trialResources(store, null); resources.issues.push('LOCAL_ACCEPTANCE_EXECUTION_NO_MODEL_TELEMETRY'); const relatedContract = contracts.find(contract => contract.id === execution.contractId); const relatedSources = relatedContract ? store.sources({ runId: relatedContract.runId }) : []; resources.sourceIds = relatedSources.map(source => source.id); resources.projectIds = [...new Set(relatedSources.map(source => store.getSource(source.id)?.context.projectId ?? '(unknown)'))];
    trials.push({ id: `pending:${execution.id}`, contractId: execution.contractId, contractRevision: execution.contractRevision, runId: null, variant: execution.suiteId,
      outcome: execution.status === 'cancelled' ? 'cancelled' : execution.status === 'setup_failed' ? 'setup_failed' : 'unverified', acceptanceReviewed: false,
      evidenceRefs: [], environment: 'local-node-acceptance', cacheCondition: 'unknown', createdAt: execution.startedAt, tokens: null, revision: 0, excludedReason: null, resources, executionId: execution.id, artifactRefs: [], execution });
  }
  const truncated = contracts.length > 200 || trials.length > limit; const visibleContracts = contracts.slice(0, 200); const visibleTrials = trials.slice(0, limit);
  return { contracts: visibleContracts, trials: visibleTrials, ...compareTrials(visibleContracts, visibleTrials, truncated), truncated,
    notes: ['Observed-run imports and explicitly reviewed local acceptance executions; local execution has no model telemetry and is not added to Codex usage.',
      'Quality outcomes and protocol conditions are explicit user-reviewed annotations. Agent completion text and exit zero do not automatically establish acceptance.',
      'Each trial is an immutable snapshot at import, including failed, cancelled, setup-failed and excluded attempts. Missing telemetry remains unknown.',
      'Observed time spans reported ledger events, not necessarily full task duration. Compactions are explicit records; failed tools and retry candidates are different measures.',
      'Recorded tool interval unions merge overlapping indexed call timestamps on one machine. They are not CPU time, background process duration, task duration or inferred waiting. Incomplete timing is shown as a known subtotal and excluded from timing distributions; older snapshots remain unknown.',
      'Fixed conditions and complete paired populations must match before an exploratory candidate is named. Multiple changed variables remain descriptive.',
      'Min/median/max are descriptive distributions; the configured minimum trial count is not a statistical power or causal guarantee. Provider factors may remain uncontrolled.',
      ...(truncated ? ['Population is truncated; comparison recommendations are disabled. Select one contract to narrow the population.'] : [])] };
}

export { setBudget, budgets } from '../diagnostics/budgets';
