import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InspectorStore, validateQuery, type PendingObservation } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { manualUsd, setManualUsdPrice } from '../src/accounting/manual-usd';
import { timeCharts } from '../src/accounting/time-charts';
import { timeline } from '../src/storage/timeline';
import { scopeOptions } from '../src/storage/scope';
import { report } from '../src/reporting/report';
import { toolsPage } from '../src/diagnostics/analyze';
import { saveContract, importTrial } from '../src/benchmarks/experiments';

const lines = (rows: readonly unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const header = (id: string, parent?: string, provider = 'openai') => ({ type: 'session_meta', payload: { id, model_provider: provider, model: 'gpt-6.1-sol', ...(parent ? { parent_thread_id: parent } : {}) } });
const response = (thread: string, id: string, input: number, output: number, tier?: string, at = '2026-10-13T01:00:00Z') => ({ type: 'token_usage_record', ...(at ? { timestamp: at } : {}), payload: { thread_id: thread, response_id: id, model: 'gpt-6.1-sol', ...(tier ? { service_tier: tier } : {}), usage: { input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: output } } });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-scope-')); const store = new InspectorStore(path.join(root, 'hub.sqlite'));
  const rootRows = [header('root'), response('root', 'standard', 100, 20, 'standard', '2026-10-13T00:00:00Z'), { type: 'turn_context', payload: { model_provider: 'openai', service_tier: 'fast' } }, response('root', 'fast', 50, 10, 'fast'), { type: 'response_item', timestamp: '2026-10-13T01:10:00Z', payload: { type: 'function_call', call_id: 'fast-call', name: 'functions.exec', arguments: '{"cmd":"cat /scope"}' } }, { type: 'turn_context', payload: { model_provider: 'proxy', service_tier: null } }, response('root', 'proxy', 30, 5, undefined, '2026-10-13T02:00:00Z')];
  for (const [name, rows] of [['root', rootRows], ['child', [header('child', 'root'), response('child', 'child', 20, 3, 'standard')]], ['grand', [header('grand', 'child'), response('grand', 'grand', 5, 1, 'fast')]], ['other', [header('other'), response('other', 'other', 1, 1, 'standard')]], ['untimed', [header('untimed'), response('untimed', 'untimed', 7, 1, undefined, '')]]] as const) await writeFile(path.join(root, `${name}.jsonl`), lines(rows));
  await new IndexCollector(store, [root]).scan();
  return { root, store, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('provider, exact/unrecorded tier and agent unions reconcile across totals, USD, charts, timeline and reports', async () => {
  const f = await fixture();
  try {
    assert.equal(f.store.summary().usage.total.value, '254'); assert.equal(f.store.summary({ agentId: 'root' }).usage.total.value, '215'); assert.equal(f.store.summary({ agentId: 'root', agentMode: 'inclusive' }).usage.total.value, '244');
    assert.equal(f.store.summary({ provider: 'openai' }).usage.total.value, '219'); assert.equal(f.store.summary({ provider: 'proxy' }).usage.total.value, '35'); assert.equal(f.store.summary({ serviceTier: 'fast' }).usage.total.value, '66'); assert.equal(f.store.summary({ serviceTier: null }).usage.total.value, '43');
    const query = { agentId: 'root', agentMode: 'inclusive' as const, provider: 'openai', serviceTier: 'fast', from: '2026-10-13T01:00:00Z', to: '2026-10-13T02:00:00Z' };
    assert.equal(f.store.summary(query).usage.total.value, '66'); assert.equal(f.store.analytics(query).buckets.reduce((n, bucket) => n + BigInt(bucket.total ?? '0'), 0n), 66n);
    setManualUsdPrice(f.store, { mode: 'uniform', uniformRate: '1' }); assert.equal(manualUsd(f.store, query).amount, '0.000066000000');
    const chart = timeCharts(f.store, query, 1440, 1440, Date.parse('2026-10-13T03:00:00Z')); assert.equal(chart.timedKnownTotal, '66');
    const history = timeline(f.store, query); assert.equal(history.items.filter(item => item.sourceUsage.some(source => source.kind === 'response')).length, 2); assert.equal(history.items.flatMap(item => item.ledger).reduce((n, entry) => n + BigInt(entry.total ?? '0'), 0n), 66n);
    assert.equal(JSON.parse(report(f.store, query, 'json').body).summary.usage.total.value, '66'); assert.equal(toolsPage(f.store, { provider: 'openai', serviceTier: 'fast', from: query.from, to: query.to }).items.length, 1); assert.equal(toolsPage(f.store, { provider: 'proxy' }).items.length, 0);
    const options = scopeOptions(f.store); assert.deepEqual(options.providers.sort(), ['openai', 'proxy']); assert.ok(options.serviceTiers.includes(null));
  } finally { await f.close(); }
});

test('date bounds are inclusive/exclusive, normalize timezone offsets, and exclude untimed usage', async () => {
  const f = await fixture();
  try {
    const query = validateQuery({ from: '2026-10-13T09:00:00+08:00', to: '2026-10-13T10:00:00+08:00' }); assert.equal(query.from, '2026-10-13T01:00:00.000Z'); assert.equal(f.store.summary(query).usage.total.value, '91');
    assert.equal(f.store.summary({ to: '2026-10-13T01:00:00Z' }).usage.total.value, '120'); assert.equal(f.store.summary({ from: '2026-10-13T02:00:00Z' }).usage.total.value, '35');
    assert.throws(() => validateQuery({ from: 'bad' }), /INVALID_QUERY_TIME/); assert.throws(() => validateQuery({ from: query.to, to: query.from }), /INVALID_QUERY_TIME/); assert.throws(() => validateQuery({ agentMode: 'all' }), /INVALID_QUERY/);
    const first = f.store.ledger({ limit: 1 }); assert.ok(first.nextCursor); assert.throws(() => f.store.ledger({ limit: 1, cursor: first.nextCursor!, serviceTier: null }), /INVALID_CURSOR/);
  } finally { await f.close(); }
});

test('inclusive ancestry does not borrow an identically named parent from another device', async () => {
  const f = await fixture(); const directory = path.join(f.root, 'foreign'); await mkdir(directory);
  const peer = new InspectorStore(':memory:', { workspaceId: f.store.workspaceId, machineId: 'machine-two' });
  try {
    await writeFile(path.join(directory, 'child.jsonl'), lines([header('child', 'unrelated-root'), response('child', 'foreign-child', 900, 0)])); await writeFile(path.join(directory, 'grand.jsonl'), lines([header('foreign-grand', 'child'), response('foreign-grand', 'foreign-grand', 1000, 0)])); await new IndexCollector(peer, [directory]).scan();
    f.store.db.prepare('INSERT INTO devices(id,workspace_id,name,state) VALUES(?,?,?,?)').run(peer.machineId, f.store.workspaceId, 'Synthetic peer', 'active');
    for (const source of peer.sources()) { const cursor = peer.getSource(source.id)!; const rows: PendingObservation[] = peer.db.prepare('SELECT * FROM observations WHERE source_id=?').all(source.id).map(row => ({ id: String(row.id), evidenceRef: String(row.evidence_ref), generation: Number(row.generation), byteStart: Number(row.byte_start), byteEnd: Number(row.byte_end), line: Number(row.line), recordDigest: String(row.record_digest), normalized: JSON.parse(String(row.normalized)) })); f.store.commitAuthenticatedDevice(cursor, rows, peer.machineId); } f.store.reconcileDirty();
    assert.equal(f.store.summary({ runId: 'root' }).usage.total.value, '244'); assert.equal(f.store.summary({ agentId: 'child', agentMode: 'inclusive', machineId: f.store.machineId }).usage.total.value, '29'); assert.equal(f.store.summary({ agentId: 'child', agentMode: 'inclusive', machineId: peer.machineId }).usage.total.value, '1900');
  } finally { peer.close(); await f.close(); }
});

test('filtered outcomes retain complete frozen populations and never split a mixed trial or reprice its snapshot', async () => {
  const f = await fixture();
  try {
    const contract = saveContract(f.store, { runId: 'root', objective: 'fixture', acceptance: 'fixture', environment: 'fixture' });
    const trial = importTrial(f.store, { id: 'scope-trial', contractId: contract.id, contractRevision: contract.revision, runId: 'root', variant: 'mixed', outcome: 'unverified', acceptanceReviewed: false, evidenceRefs: [], environment: 'fixture', cacheCondition: 'observed' }); const frozen = JSON.stringify(trial.resources);
    assert.deepEqual(trial.resources!.providers!.sort(), ['openai', 'proxy']); assert.equal(trial.resources!.knownTokens, '244');
    assert.equal(JSON.parse(report(f.store, { provider: 'openai' }, 'json').body).outcomes.length, 0); assert.equal(JSON.parse(report(f.store, { agentId: 'root', agentMode: 'exclusive' }, 'json').body).outcomes.length, 0);
    assert.equal(JSON.parse(report(f.store, { agentId: 'root', agentMode: 'inclusive' }, 'json').body).outcomes.length, 1); assert.equal(JSON.parse(report(f.store, { from: '2026-10-13T01:00:00Z' }, 'json').body).outcomes.length, 0);
    assert.equal(JSON.stringify(JSON.parse(String(f.store.db.prepare('SELECT record FROM trials WHERE id=?').get(trial.id)!.record)).resources), frozen);
  } finally { await f.close(); }
});
