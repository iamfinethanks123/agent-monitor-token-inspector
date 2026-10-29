import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InspectorStore, type PendingObservation } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { explainLedger } from '../src/storage/ledger-explanation';
import { bumpPrivacyVersion } from '../src/storage/project-privacy';
import { deleteSource } from '../src/storage/privacy';

const header = { type: 'session_meta', payload: { id: 'explain-thread', model_provider: 'openai', model: 'gpt-6-sol' } };
const at = (n: number) => new Date(Date.UTC(2026, 9, 14, 0, 0, n)).toISOString();
const response = (id: string, i: number, n: number) => ({ type: 'token_usage_record', timestamp: at(n), ordinal: n, payload: { thread_id: 'explain-thread', response_id: id, usage: { input_tokens: i, output_tokens: 2 }, ignored_text: 'PRIVATE_CONTENT_MUST_NOT_BE_RETURNED' } });
const counter = (i: number, n: number) => ({ type: 'event_msg', timestamp: at(n), ordinal: n, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: i, output_tokens: 0 } } } });
const lines = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
async function fixture(rows: unknown[], run: (store: InspectorStore, collector: IndexCollector, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ledger-explanation-')); const file = path.join(root, 'run.jsonl');
  const store = new InspectorStore(path.join(root, 'index.sqlite'), { workspaceId: 'explanation-workspace', machineId: 'recording-machine' });
  const collector = new IndexCollector(store, [root]);
  try { await writeFile(file, lines([header, ...rows])); await collector.scan(); await run(store, collector, file); }
  finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

test('all replay supports page beyond the stored evidence window without changing totals or distinct equal responses', async () => {
  await fixture([...Array.from({ length: 73 }, (_, n) => response('a', 10, n + 1)), response('b', 10, 74)], async (store, collector, file) => {
    const before = store.summary().usage.total.value; assert.equal(before, '24');
    const entry = store.ledger().items.find(row => row.identity.responseId === 'a')!;
    assert.equal(entry.evidenceRefs.length, 20);
    const query = { id: entry.id, revision: entry.revision }; const first = explainLedger(store, query);
    assert.equal(first.observationCount, 73); assert.equal(first.supportCount, 73); assert.equal(first.controlCount, 0); assert.equal(first.observations.length, 50); assert(first.nextCursor);
    assert.equal(first.entry.usage.cachedInput.value, null); assert.equal(first.entry.usage.output.value, '2');
    assert(!JSON.stringify(first).includes('PRIVATE_CONTENT_MUST_NOT_BE_RETURNED'));
    assert(first.observations.every(row => row.recordingMachineId === 'recording-machine'));
    await appendFile(file, lines([response('c', 5, 75)])); await collector.scan(); assert.equal(store.summary().usage.total.value, '31');
    const second = explainLedger(store, { ...query, cursor: first.nextCursor });
    assert.equal(second.observations.length, 23); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.observations, ...second.observations].map(row => row.id)).size, 73);
    assert(second.activeRevision > entry.revision); assert.equal(second.entry.usage.total.value, '12');
    const other = store.ledger().items.find(row => row.identity.responseId === 'b')!;
    assert.throws(() => explainLedger(store, { id: other.id, revision: entry.revision, cursor: first.nextCursor }), /INVALID_CURSOR/);
    assert.throws(() => explainLedger(store, { ...query, raw: true }), /INVALID_LEDGER_EXPLANATION/);
    assert.equal(store.summary().usage.total.value, '31');
  });
});

test('counter endpoints, unknown subsets and conflicting response history remain reconciliation evidence, not extra requests', async () => {
  await fixture([counter(11000, 1), counter(33000, 2), counter(1000, 3)], async store => {
    assert.equal(store.summary().usage.total.value, '33000');
    const entry = store.ledger({ includeQuarantined: true }).items.find(row => row.issues.includes('AMBIGUOUS_COUNTER_DECREASE'))!;
    const explanation = explainLedger(store, { id: entry.id, revision: entry.revision });
    assert.equal(explanation.entry.selectionStatus, 'quarantined'); assert.equal(explanation.entry.grain, 'interval');
    assert.equal(explanation.observationCount, 2); assert.equal(explanation.supportCount, 1); assert.equal(explanation.controlCount, 1);
    assert.deepEqual(explanation.observations.map(row => row.measurements[0].values.total), ['33000','1000']);
    assert.equal(explanation.entry.usage.cachedInput.value, null); assert.equal(explanation.entry.usage.output.value, '0');
    assert(explanation.entry.usage.total.value === null || BigInt(explanation.entry.usage.total.value) >= 0n);
    assert.equal(store.summary().usage.total.value, '33000');
  });
  await fixture([response('a', 10, 1)], async (store, collector, file) => {
    const original = store.ledger().items[0]; await appendFile(file, lines([response('a', 9, 2)])); await collector.scan();
    const current = store.ledger({ includeQuarantined: true }).items[0]; const view = explainLedger(store, { id: current.id, revision: current.revision });
    assert.equal(view.entry.selectionStatus, 'quarantined'); assert.deepEqual(view.history.map(row => row.selectionStatus), ['quarantined','selected']);
    assert.deepEqual(view.observations.map(row => row.measurements[0].values.total), ['12','11']);
    assert.equal(explainLedger(store, { id: original.id, revision: original.revision }).entry.selectionStatus, 'selected');
    assert.equal(store.summary().usage.total.value, null);
  });
});

test('historical parser support stays attached to its revision; reanalysis/privacy invalidates cursors and deletion removes old explanations', async () => {
  await fixture(Array.from({ length: 73 }, (_, n) => response('a', 10, n + 1)), async store => {
    const original = store.ledger().items[0]; const query = { id: original.id, revision: original.revision }; const before = explainLedger(store, query); const sourceId = store.sources()[0].id;
    const pending: PendingObservation[] = store.db.prepare('SELECT * FROM observations WHERE source_id=? ORDER BY sequence').all(sourceId).map(row => {
      const normalized = JSON.parse(String(row.normalized));
      for (const measurement of normalized.measurements) if (measurement.kind === 'response') { measurement.values.input = '11'; measurement.values.total = '13'; }
      return { id: String(row.id), evidenceRef: String(row.evidence_ref), generation: Number(row.generation), byteStart: Number(row.byte_start), byteEnd: Number(row.byte_end), line: Number(row.line), recordDigest: String(row.record_digest), normalized };
    });
    store.publishAnalysis(sourceId, pending); assert.equal(store.summary().usage.total.value, '13');
    assert.throws(() => explainLedger(store, { ...query, cursor: before.nextCursor! }), /INVALIDATED/);
    const historical = explainLedger(store, query); assert.equal(historical.observations[0].measurements[0].values.total, '12');
    const updated = store.ledger().items[0]; const latest = explainLedger(store, { id: updated.id, revision: updated.revision });
    assert.equal(latest.observations[0].measurements[0].values.total, '13'); assert.deepEqual(latest.history.map(row => row.total), ['13','12']);
    bumpPrivacyVersion(store); assert.throws(() => explainLedger(store, { id: updated.id, revision: updated.revision, cursor: latest.nextCursor! }), /INVALIDATED/);
    const source = store.getSource(sourceId)!; const bytes = await readFile(source.path); deleteSource(store, sourceId);
    assert.throws(() => explainLedger(store, query), /UNAVAILABLE/); assert.deepEqual(await readFile(source.path), bytes);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});
