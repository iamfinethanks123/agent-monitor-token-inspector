import { object } from '../accounting/codex-observations';
import { integer } from '../accounting/integers';
import type { InspectorStore } from '../storage/InspectorStore';
import type { BenchmarkExecution, BenchmarkFile } from '../shared/benchmark-execution';

function files(value: unknown): BenchmarkFile[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('INVALID_BENCHMARK_RECORD');
  return value.map(raw => { const item = object(raw); if (!item || Object.keys(item).some(key => !['id', 'role', 'bytes', 'sha256', 'summary'].includes(key)) || typeof item.id !== 'string' || !/^[a-zA-Z0-9:._-]{1,128}$/.test(item.id) || !['input','output'].includes(String(item.role)) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('INVALID_BENCHMARK_RECORD');
    const summary = item.summary === undefined ? undefined : object(item.summary);
    if (item.summary !== undefined && (!summary || Object.keys(summary).some(key => !['tests','passed','failed','skipped'].includes(key)) || ['tests','passed','failed','skipped'].some(key => !Number.isSafeInteger(summary[key]) || Number(summary[key]) < 0) || Number(summary.passed) + Number(summary.failed) + Number(summary.skipped) !== summary.tests)) throw new Error('INVALID_BENCHMARK_RECORD');
    return { id: item.id, role: item.role as BenchmarkFile['role'], bytes: integer(item.bytes), sha256: item.sha256, ...(summary ? { summary: summary as BenchmarkFile['summary'] } : {}) }; });
}

export function recoverInterruptedBenchmarks(store: InspectorStore): void {
  for (const execution of benchmarkExecutions(store)) if (execution.status === 'running') recordBenchmarkExecution(store, { ...execution, status: 'interrupted', completedAt: new Date().toISOString(), elapsedMs: null, issues: [...execution.issues, 'INTERRUPTED_EXECUTION_RESULT_UNKNOWN'] });
}
export function benchmarkExecutions(store: InspectorStore, contractId?: unknown): BenchmarkExecution[] {
  if (contractId !== undefined && (typeof contractId !== 'string' || contractId.length > 128)) throw new Error('INVALID_CONTRACT');
  return store.db.prepare("SELECT value FROM settings WHERE key LIKE 'benchmark-execution:%' ORDER BY key").all().map(row => JSON.parse(String(row.value)) as BenchmarkExecution).filter(row => !contractId || row.contractId === contractId);
}
export function recordBenchmarkExecution(store: InspectorStore, input: unknown): void {
  const value = object(input); const keys = ['id','contractId','contractRevision','suiteId','planDigest','status','startedAt','completedAt','elapsedMs','exitCode','inputFiles','outputFiles','stdoutBytes','stderrBytes','runtimeVersion','network','nodePermissions','contentRetained','acceptance','issues'];
  if (!value || Object.keys(value).some(key => !keys.includes(key)) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || typeof value.contractId !== 'string' || typeof value.suiteId !== 'string' || !/^[a-zA-Z0-9:._-]{1,128}$/.test(value.suiteId) || typeof value.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.planDigest)) throw new Error('INVALID_BENCHMARK_RECORD');
  const contract = store.db.prepare('SELECT record FROM task_contracts WHERE workspace_id=? AND id=?').get(store.workspaceId, value.contractId); if (!contract || JSON.parse(String(contract.record)).revision !== value.contractRevision) throw new Error('CONTRACT_REVISION_CHANGED');
  const contractRecord = JSON.parse(String(contract.record)); if (!store.sources({ runId: contractRecord.runId }).length) throw new Error('BENCHMARK_SCOPE_UNAVAILABLE');
  if (!['running','completed','failed','cancelled','timed_out','setup_failed','output_limit','interrupted'].includes(String(value.status)) || value.acceptance !== 'unreviewed' || value.contentRetained !== false || value.network !== 'os_denied' || value.nodePermissions !== 'guardrail' || typeof value.runtimeVersion !== 'string' || value.runtimeVersion.length > 128 || !Array.isArray(value.issues) || value.issues.length > 20 || value.issues.some(issue => typeof issue !== 'string' || !/^[A-Z0-9_]{1,128}$/.test(issue))) throw new Error('INVALID_BENCHMARK_RECORD');
  for (const key of ['startedAt','completedAt']) if (value[key] !== null && (typeof value[key] !== 'string' || new Date(value[key] as string).toISOString() !== value[key])) throw new Error('INVALID_BENCHMARK_RECORD');
  if (value.elapsedMs !== null && (!Number.isSafeInteger(value.elapsedMs) || Number(value.elapsedMs) < 0) || value.exitCode !== null && !Number.isInteger(value.exitCode)) throw new Error('INVALID_BENCHMARK_RECORD');
  const record = { ...value, inputFiles: files(value.inputFiles), outputFiles: files(value.outputFiles), stdoutBytes: integer(value.stdoutBytes), stderrBytes: integer(value.stderrBytes) } as unknown as BenchmarkExecution;
  const previous = store.getSetting(`benchmark-execution:${record.id}`); if (previous) { const old = JSON.parse(previous) as BenchmarkExecution; if (old.status !== 'running' || old.planDigest !== record.planDigest || old.contractId !== record.contractId) throw new Error('BENCHMARK_RECORD_IMMUTABLE'); }
  store.setSetting(`benchmark-execution:${record.id}`, JSON.stringify(record)); store.audit(record.status === 'running' ? 'benchmark.start' : 'benchmark.finish', record.id);
}
