import type { InspectorStore } from '../storage/InspectorStore';
import { object } from '../accounting/codex-observations';
import type { RunTaskView, TaskContract, TrialRecord } from '../shared/inspector';

export function runTask(store: InspectorStore, input: unknown): RunTaskView {
  const value = object(input);
  if (!value || Object.keys(value).some(key => !['runId', 'machineId'].includes(key)) || typeof value.runId !== 'string' || !value.runId || value.runId.length > 1024 || value.machineId !== undefined && (typeof value.machineId !== 'string' || !value.machineId || value.machineId.length > 128)) throw new Error('INVALID_RUN_TASK_QUERY');
  const contracts = store.db.prepare('SELECT record FROM task_contracts WHERE workspace_id=? AND run_id=? ORDER BY rowid DESC LIMIT 1').get(store.workspaceId, value.runId);
  const contract = contracts ? JSON.parse(String(contracts.record)) as TaskContract : null;
  const contractCount = Number(store.db.prepare('SELECT COUNT(*) n FROM task_contracts WHERE workspace_id=? AND run_id=?').get(store.workspaceId, value.runId)!.n);
  const records = contract ? store.db.prepare(`SELECT record FROM trials WHERE workspace_id=? AND contract_id=? AND (json_extract(record,'$.runId')=? ${value.machineId ? "AND json_extract(record,'$.machineId')=?" : ''}) ORDER BY rowid DESC LIMIT 21`).all(store.workspaceId, contract.id, value.runId, ...(value.machineId ? [value.machineId] : [])) : [];
  const trials = records.slice(0, 20).map(row => {
    const trial = JSON.parse(String(row.record)) as TrialRecord;
    return { id: trial.id, contractRevision: trial.contractRevision, outcome: trial.outcome, acceptanceReviewed: trial.acceptanceReviewed, createdAt: trial.createdAt, evidenceRefs: trial.evidenceRefs, excludedReason: trial.excludedReason };
  });
  return { runId: value.runId, contract, contractCount, trials, truncated: records.length > 20,
    notes: ['Latest immutable reference contract; observed-run trials match this run and the selected machine.', 'No matching reviewed trial means acceptance is unknown. Agent completion text and exit zero are not task acceptance.', 'Local benchmark executions and other-run comparisons remain in Experiments; they are not attributed to this Codex run.'] };
}
