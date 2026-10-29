import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector, MAX_RECORD_BYTES } from '../src/collector/IndexCollector';
import { parseLossless, integer } from '../src/accounting/integers';

const header = { type: 'session_meta', payload: { id: 'thread-test', session_id: 'session-test', cli_version: '0.162.0-alpha.2', model_provider: 'openai', cwd: '/synthetic/project' } };
const iso = (n: number) => new Date(Date.UTC(2026, 9, 12, 0, 0, n)).toISOString();
const response = (id: string, i: number | string, o: number | string, n: number, extra = {}) => ({ type: 'token_usage_record', ordinal: n, timestamp: iso(n), payload: { thread_id: 'thread-test', response_id: id, session_id: 'session-test', usage: { input_tokens: i, output_tokens: o, ...extra } } });
const counter = (i: number, o: number, n: number) => ({ type: 'event_msg', ordinal: n, timestamp: iso(n), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: i, output_tokens: o } } } });
const lines = (records: unknown[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n';

async function fixture(records: unknown[], run: (store: InspectorStore, collector: IndexCollector, root: string, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-accounting-'));
  const file = path.join(root, 'session.jsonl');
  const store = new InspectorStore(path.join(root, 'index.sqlite'), { workspaceId: 'test-workspace', machineId: 'test-machine' });
  const collector = new IndexCollector(store, [root]);
  try { await writeFile(file, lines([header, ...records])); await collector.scan(); await run(store, collector, root, file); }
  finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

test('identified response ledger preserves subset semantics, controls and replay evidence', async () => {
  await fixture([
    response('a', 12000, 1000, 1, { cached_input_tokens: 8000, reasoning_output_tokens: 600 }), counter(12000, 1000, 2),
    response('b', 19000, 1500, 3, { cached_input_tokens: 12000, reasoning_output_tokens: 900 }), counter(31000, 2500, 4),
    response('c', 22000, 2000, 5, { cached_input_tokens: 16000, reasoning_output_tokens: 1200 }), counter(53000, 4500, 6),
  ], async (store, collector, _root, file) => {
    for (let i = 0; i < 10; i++) await collector.scan();
    const summary = store.summary();
    assert.equal(summary.usage.total.value, '57500'); assert.equal(summary.usage.cachedInput.value, '36000'); assert.equal(summary.usage.reasoningOutput.value, '2700');
    assert.equal(summary.identifiedResponses, 3); assert.equal(summary.aggregates, 0); assert.equal(summary.intervals, 0);
    assert.equal(store.observationCount(), 7);
    await appendFile(file, lines([response('a', 12000, 1000, 7, { cached_input_tokens: 8000, reasoning_output_tokens: 600 })]));
    await collector.scan();
    assert.equal(store.summary().usage.total.value, '57500');
    assert.equal(store.ledger().items.find(e => e.identity.responseId === 'a')?.evidenceCount, 2);
  });
});

test('anonymous counters form an untimed baseline and intervals; a decrease is quarantined', async () => {
  await fixture([counter(11000, 0, 1), counter(33000, 0, 2), counter(33000, 0, 3), counter(1000, 0, 4)], async store => {
    const summary = store.summary();
    assert.equal(summary.usage.total.value, '33000'); assert.equal(summary.untimedTotal.value, '11000');
    assert.equal(summary.usage.cachedInput.value, null); assert.equal(summary.usage.output.value, '0');
    assert.equal(summary.identifiedResponses, 0); assert.equal(summary.intervals, 1); assert.equal(summary.quarantinedEntries, 1);
    assert(store.ledger({ includeQuarantined: true }).items.some(e => e.issues.includes('AMBIGUOUS_COUNTER_DECREASE')));
  });
});

test('equal usage with distinct response IDs survives; conflicting identities and invalid subsets remain evidence', async () => {
  await fixture([response('a', 10, 2, 1), response('b', 10, 2, 2), response('bad', 10, 2, 3, { cached_input_tokens: 11 })], async (store, collector, _root, file) => {
    assert.equal(store.summary().usage.total.value, '24'); assert.equal(store.summary().quarantinedEntries, 1);
    await appendFile(file, lines([response('a', 9, 2, 4)])); await collector.scan();
    assert.equal(store.summary().usage.total.value, '12'); assert.equal(store.summary().quarantinedEntries, 2);
    assert.equal(store.ledger({ includeQuarantined: true }).items.find(e => e.identity.responseId === 'a')?.evidenceCount, 2);
    assert.equal(store.observationCount(), 5);
  });
});

test('integer lexemes larger than 2^53 remain exact and overflow is rejected', async () => {
  const parsed = parseLossless('{"input_tokens":9007199254740993,"used_percent":37.5}') as Record<string, unknown>;
  assert.equal(parsed.input_tokens, '9007199254740993'); assert.equal(parsed.used_percent, '37.5');
  assert.throws(() => integer('9223372036854775808'), /INTEGER_OVERFLOW/);
  await fixture([response('big', '9007199254740993', 2, 1)], async store => {
    assert.equal(store.summary().usage.total.value, '9007199254740995');
    assert.equal(store.ledger().items[0].usage.input.value, '9007199254740993');
  });
});

test('split UTF-8, restart, generation changes and stale page cursors preserve committed history', async () => {
  await fixture([response('a', 10, 2, 1)], async (store, collector, root, file) => {
    const source = store.sources()[0]; const before = store.observationCount();
    const text = Buffer.from(lines([{ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ text: 'café' }] } }]));
    const split = text.indexOf(Buffer.from('é')) + 1;
    await appendFile(file, text.subarray(0, split)); await collector.scan(); assert.equal(store.observationCount(), before);
    await appendFile(file, text.subarray(split)); await collector.scan(); assert.equal(store.observationCount(), before + 1);
    const oldEvidence = store.ledger().items[0].evidenceRefs[0];
    const eventPage = store.events({ limit: 1 }); assert(eventPage.nextCursor);
    await writeFile(file, lines([header, response('a', 10, 2, 1), response('b', 20, 3, 2)])); await collector.scan();
    assert.equal(store.sources()[0].generation, source.generation + 1); assert.equal(store.summary().usage.total.value, '35');
    assert.equal((await collector.evidence(oldEvidence)).state, 'source_changed');
    assert.throws(() => store.events({ cursor: eventPage.nextCursor! }), /REVISION_CHANGED/);
    const reopened = new InspectorStore(path.join(root, 'index.sqlite'));
    try { assert.equal(reopened.summary().usage.total.value, '35'); assert.equal(reopened.observationCount(), store.observationCount()); }
    finally { reopened.close(); }
  });
});

test('10,000-record history remains pageable after restart; oversized and unsupported data cannot create usage', async () => {
  await fixture(Array.from({ length: 10000 }, (_, n) => ({ type: 'event_msg', payload: { type: 'agent_message', message: `synthetic-${n}` } })), async (store, collector, root, file) => {
    assert.equal(store.observationCount(), 10001);
    let page = store.events(); let count = page.items.length; let last = page.items.at(-1);
    while (page.nextCursor) { page = store.events({ cursor: page.nextCursor }); count += page.items.length; last = page.items.at(-1); }
    assert.equal(count, 10001); assert.equal(last?.line, 10001);
    await appendFile(file, 'x'.repeat(MAX_RECORD_BYTES + 100) + '\n' + lines([{ type: 'unrecognized_usage', payload: { input_tokens: 999999 } }, response('late', 5, 1, 10002)]));
    await collector.scan(); assert.equal(store.summary().usage.total.value, '6'); assert(store.sources()[0].issues.includes('OVERSIZED_RECORD'));
    const reopened = new InspectorStore(path.join(root, 'index.sqlite'));
    try { assert.equal(reopened.events({ limit: 1 }).items[0].line, 1); assert.equal(reopened.summary().usage.total.value, '6'); }
    finally { reopened.close(); }
  });
});

test('storage write failure does not advance the source cursor or erase the last ledger', async () => {
  await fixture([response('a', 10, 2, 1)], async (store, collector, _root, file) => {
    const sourceId = store.sources()[0].id; const offset = store.getSource(sourceId)!.offset;
    await appendFile(file, lines([response('b', 20, 3, 2)]));
    store.db.exec('PRAGMA query_only=ON');
    await assert.rejects(collector.scan(), (error: unknown) => (error as { errcode?: number }).errcode === 8);
    assert.equal(store.getSource(sourceId)!.offset, offset); assert.equal(store.summary().usage.total.value, '12');
    store.db.exec('PRAGMA query_only=OFF'); await collector.scan(); assert.equal(store.summary().usage.total.value, '35');
  });
});

test('mixed native ordinals and record positions never overlap identified responses with counter remainders', async () => {
  const withoutOrdinal = { ...counter(12, 2, 2), ordinal: undefined };
  await fixture([response('mixed-a', 12, 2, 100), withoutOrdinal, response('mixed-b', 20, 3, 101), counter(32, 5, 102)], async store => {
    assert.equal(store.summary().usage.total.value, '37'); assert.equal(store.summary().identifiedResponses, 2);
    assert.equal(store.summary().quarantinedEntries, 0); assert.equal(store.summary().intervals, 0);
  });
});

test('native counter ordering is independent of arrival order within one source generation', async () => {
  await fixture([counter(33000, 0, 3), counter(11000, 0, 1), counter(33000, 0, 2)], async store => {
    assert.equal(store.summary().usage.total.value, '33000'); assert.equal(store.summary().quarantinedEntries, 0);
  });
});

test('a second stream with copied history and new responses cannot add an unproven historical remainder', async () => {
  await fixture([response('shared', 10, 2, 1), counter(10, 2, 2)], async (store, collector, root) => {
    const copy = path.join(root, 'second-stream.jsonl');
    await writeFile(copy, lines([header, response('shared', 10, 2, 1), response('new', 20, 3, 2), counter(30, 5, 3)])); await collector.scan();
    assert.equal(store.summary().usage.total.value, '35'); assert.equal(store.summary().identifiedResponses, 2);
    assert.ok(store.ledger({ includeQuarantined: true }).items.some(entry => entry.issues.includes('UNPROVEN_COUNTER_REPLICA')));
  });
});

test('unchanged ledger content is stored once while every revision and its evidence remain accessible', async () => {
  await fixture([response('stable', 10, 2, 1)], async store => {
    const scope = store.ledger().items[0].scopeId; const first = store.ledger().items[0];
    for (let i = 0; i < 30; i++) store.reconcile([scope]);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM ledger_payloads').get()!.n, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM ledger').get()!.n, 31);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM ledger_links').get()!.n, 31);
    assert.deepEqual(JSON.parse(String(store.db.prepare('SELECT entry FROM ledger WHERE revision=?').get(first.revision)!.entry)), first);
    assert.equal(store.summary().usage.total.value, '12');
  });
});
