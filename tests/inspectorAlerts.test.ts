import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { analyze } from '../src/diagnostics/analyze';
import { checkAlerts, incidents, recordFindings, suppressAlerts, removeSuppression } from '../src/diagnostics/incidents';
import { budgets, setBudget, evaluateBudgets, budgetValue } from '../src/diagnostics/budgets';
import { deleteSource } from '../src/storage/privacy';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-alerts-')); const database = path.join(root, 'index.sqlite'); const file = path.join(root, 'run.jsonl');
  const store = new InspectorStore(database); const collector = new IndexCollector(store, [root], 'synthetic-alert-key');
  await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: 'alert-run', model_provider: 'openai' } }) + '\n'); await collector.scan();
  const append = async (rows: unknown[]) => { await appendFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); await collector.scan(); };
  const failures = (count: number, start: number, offset = 0) => Array.from({ length: count }, (_, i) => [
    { type: 'response_item', timestamp: new Date(start + i * 50).toISOString(), payload: { type: 'function_call', call_id: `failure-${offset + i}`, name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) } },
    { type: 'response_item', timestamp: new Date(start + i * 50 + 1).toISOString(), payload: { type: 'function_call_output', call_id: `failure-${offset + i}`, output: 'Expected 4, received 5\nProcess exited with code 1' } },
  ]).flat();
  return { root, database, file, store, collector, append, failures, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('100 recurring failures produce one durable alert and cooldown controls later updates', async () => {
  const f = await fixture(); const now = Date.now();
  try {
    checkAlerts(f.store, now - 31000); await f.append(f.failures(100, now)); checkAlerts(f.store, now + 5000);
    let view = incidents(f.store); assert.equal(view.items.length, 1); assert.equal(view.items[0].occurrences, 100); assert.equal(view.items[0].updates, 1);
    await f.append(f.failures(1, now + 10000, 100)); checkAlerts(f.store, now + 10001); assert.equal(incidents(f.store).items[0].updates, 1);
    const reopened = new InspectorStore(f.database); try { checkAlerts(reopened, now + 11000); assert.equal(incidents(reopened).items[0].updates, 1); } finally { reopened.close(); }
    await f.append(f.failures(1, now + 310000, 101)); checkAlerts(f.store, now + 310001); view = incidents(f.store);
    assert.equal(view.items[0].occurrences, 102); assert.equal(view.items[0].updates, 2);
    f.store.annotate(view.items[0].id, 'intentional'); await f.append(f.failures(1, now + 320000, 102)); checkAlerts(f.store, now + 620001);
    assert.equal(incidents(f.store).items[0].updates, 2); assert.equal(incidents(f.store).items[0].annotation, 'intentional');
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE operation='incident.alert'").get()!.n, 2);
  } finally { await f.close(); }
});

test('historical import and scoped suppression preserve findings without live notification floods', async () => {
  const f = await fixture(); const now = Date.now();
  try {
    checkAlerts(f.store, now - 31000); await f.append(f.failures(100, now - 86400000)); checkAlerts(f.store, now);
    let view = incidents(f.store); assert.equal(view.items[0].updates, 0); assert.equal(view.items[0].historical, true);
    const findings = analyze(f.store).findings; recordFindings(f.store, findings, now); assert.equal(incidents(f.store).items[0].updates, 0);
    suppressAlerts(f.store, { query: { runId: 'alert-run' }, detectorId: 'retry-recurrence', hours: 24 });
    await f.append(f.failures(3, now, 100)); checkAlerts(f.store, now + 1000); view = incidents(f.store);
    assert.equal(view.items[0].historical, false); assert.equal(view.items[0].updates, 0); assert.equal(view.suppressions.length, 1);
    assert.throws(() => suppressAlerts(f.store, { query: {}, detectorId: 'retry-recurrence', hours: 24 }), /SUPPRESSION_SCOPE_REQUIRED/);
    removeSuppression(f.store, view.suppressions[0].id); checkAlerts(f.store, now + 32000); assert.equal(incidents(f.store).items[0].updates, 1);
  } finally { await f.close(); }
});

test('startup baselines recent records written while the monitor was closed', async () => {
  const f = await fixture(); const now = Date.now();
  try {
    checkAlerts(f.store, now - 31000); await f.append(f.failures(100, now));
    checkAlerts(f.store, now + 5000, true); recordFindings(f.store, analyze(f.store).findings, now + 5000);
    assert.equal(incidents(f.store).items[0].updates, 0);
    assert.equal(incidents(f.store).items[0].historical, true);
    await f.append(f.failures(1, now + 36000, 100)); checkAlerts(f.store, now + 36001);
    assert.equal(incidents(f.store).items[0].updates, 1);
  } finally { await f.close(); }
});

test('background analysis handles one source per pass and rotates past a repeatedly changing source', async () => {
  const f = await fixture(); const now = Date.now();
  try {
    const files = [f.file, path.join(f.root, 'second.jsonl'), path.join(f.root, 'third.jsonl')];
    for (const [i, file] of files.entries()) await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: `rotation-${i}`, model_provider: 'openai' } }) + '\n');
    await f.collector.scan(); checkAlerts(f.store, now - 31000, true);
    for (const file of files) await appendFile(file, f.failures(3, now).map(row => JSON.stringify(row)).join('\n') + '\n');
    await f.collector.scan(); checkAlerts(f.store, now + 1000);
    const first = incidents(f.store).items; assert.equal(first.length, 1, 'A scan must not run multiple complete source analyses without yielding to interface queries');
    const busy = f.store.getSource(first[0].sourceId)!;
    await appendFile(busy.path, f.failures(1, now + 2000, 3).map(row => JSON.stringify(row)).join('\n') + '\n');
    await f.collector.scan(); checkAlerts(f.store, now + 3000);
    assert.equal(incidents(f.store).items.length, 2, 'The continuously changing first source must not starve another source');
    checkAlerts(f.store, now + 4000); assert.equal(incidents(f.store).items.length, 3);
    checkAlerts(f.store, now + 5000); assert.equal(incidents(f.store).items.find(item => item.sourceId === busy.id)?.occurrences, 4);
    for (const source of f.store.sources()) assert.equal(Number(f.store.db.prepare('SELECT line FROM alert_checkpoints WHERE source_id=?').get(source.id)!.line), f.store.getSource(source.id)!.line);
    assert.equal(f.store.summary().usage.total.value, null);
  } finally { await f.close(); }
});

test('incident ordering uses recorded evidence time when historical and live records share an update time',async()=>{
 const f=await fixture();const now=Date.now();try{
  checkAlerts(f.store,now-31000);await f.append(f.failures(3,now-86400000));checkAlerts(f.store,now);await f.append(f.failures(3,now,3));checkAlerts(f.store,now+1000);
  const saved=f.store.db.prepare('SELECT record FROM incidents').all().map(row=>JSON.parse(String(row.record)));assert.equal(saved.length,2);f.store.db.exec('DELETE FROM incidents');
  for(const record of saved){record.id=`finding:${(record.historical?'0':'f').repeat(64)}`;record.lastSeenAt=new Date(now+1000).toISOString();f.store.db.prepare('INSERT INTO incidents VALUES(?,?,?,?)').run(record.id,f.store.workspaceId,record.sourceId,JSON.stringify(record));}
  const ordered=incidents(f.store).items;assert.equal(ordered[0].historical,false);assert.equal(ordered[1].historical,true);assert(Date.parse(ordered[0].lastObservedAt!)>Date.parse(ordered[1].lastObservedAt!));
 }finally{await f.close();}
});

test('separate budget units use exact ledger values and historical crossings remain quiet', async () => {
  const f = await fixture(); const now = Date.now();
  try {
    const usage = (id: string, at: number, input: number, cache?: number) => ({ type: 'token_usage_record', timestamp: new Date(at).toISOString(), payload: { thread_id: 'alert-run', response_id: id, usage: { input_tokens: input, ...(cache === undefined ? {} : { cached_input_tokens: cache }), output_tokens: 2 } } });
    await f.append([usage('budget-first', now, 10, 5)]); const query = { runId: 'alert-run' };
    setBudget(f.store, { query, tokenLimit: '20' }); setBudget(f.store, { query, metric: 'uncached_input', tokenLimit: '9' });
    setBudget(f.store, { query, metric: 'elapsed_ms', tokenLimit: '1000' }); setBudget(f.store, { query, metric: 'api_estimate', currency: 'USD', tokenLimit: '0.000000000001' });
    assert.equal(budgets(f.store).policies.length, 4); assert.equal(budgets(f.store).policies.find(policy => policy.metric === 'uncached_input')!.current, '5');
    assert.equal(budgets(f.store).policies.find(policy => policy.metric === 'api_estimate')!.current, null);
    await f.append([usage('budget-second', now + 2000, 10, 5)]); const sourceIds = new Set(f.store.sources().map(source => source.id)); evaluateBudgets(f.store, sourceIds, sourceIds, now + 2000);
    const crossed = budgets(f.store); assert.equal(crossed.policies.filter(policy => policy.crossed).length, 3);
    evaluateBudgets(f.store, sourceIds, sourceIds, now + 3000); assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE operation='budget.crossed'").get()!.n, 3);
    setBudget(f.store, { query, tokenLimit: '1' }); assert.equal(budgets(f.store).policies.find(policy => policy.metric === 'tokens')!.historical, true);
    await f.append([usage('unknown-cache', now + 4000, 100)]); assert.equal(budgets(f.store).policies.find(policy => policy.metric === 'uncached_input')!.current, null);
    const timePolicy = crossed.policies.find(policy => policy.metric === 'elapsed_ms')!; assert.ok(budgetValue(f.store, timePolicy).issues.includes('OBSERVED_TIMESTAMP_SPAN_NOT_RUNTIME'));
    assert.throws(() => setBudget(f.store, { query, metric: 'api_estimate', currency: 'USD', tokenLimit: '0.0000000000001' }), /INVALID_BUDGET/);
  } finally { await f.close(); }
});

test('new output/compaction/gap thresholds persist separately and source deletion removes derived incidents', async () => {
  const f = await fixture(); const now = Date.now();
  try {
    const rows: unknown[] = [
      { type: 'response_item', timestamp: new Date(now).toISOString(), payload: { type: 'function_call', call_id: 'large-output', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) } },
      { type: 'response_item', timestamp: new Date(now + 1).toISOString(), payload: { type: 'function_call_output', call_id: 'large-output', output: 'x'.repeat(262144) } },
      ...Array.from({ length: 3 }, (_, i) => ({ type: 'compacted', timestamp: new Date(now + 100 + i).toISOString(), payload: {} })),
    ];
    await f.append(rows); await appendFile(f.file, 'invalid JSON\n'); await f.collector.scan();
    const diagnostics = analyze(f.store); assert.ok(diagnostics.findings.some(finding => finding.detectorId === 'large-output')); assert.ok(diagnostics.findings.some(finding => finding.detectorId === 'compaction-burst')); assert.ok(diagnostics.findings.some(finding => finding.detectorId === 'collector-gap'));
    recordFindings(f.store, diagnostics.findings); assert.equal(incidents(f.store).items.length, 3);
    deleteSource(f.store, f.store.sources()[0].id); assert.equal(incidents(f.store).items.length, 0); assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
    await f.collector.scan(); assert.equal(f.store.sources().length, 0);
  } finally { await f.close(); }
});
