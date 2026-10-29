import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { saveContract, importTrial } from '../src/benchmarks/experiments';
import { runTask } from '../src/benchmarks/run-task';

test('run inspector reads its latest contract and evidence-bound outcome without mixing another machine', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run-task-')); const store = new InspectorStore(':memory:');
  try {
    await writeFile(path.join(root, 'run.jsonl'), [
      { type: 'session_meta', payload: { id: 'run-task', model_provider: 'openai' } },
      { type: 'token_usage_record', payload: { thread_id: 'run-task', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n'); await new IndexCollector(store, [root]).scan();
    assert.equal(runTask(store, { runId: 'run-task' }).contract, null);
    saveContract(store, { runId: 'run-task', objective: 'Earlier goal', acceptance: 'Old criteria', environment: 'fixture' });
    const contract = saveContract(store, { runId: 'run-task', objective: 'Current goal', acceptance: 'Reviewed result', environment: 'fixture', permittedScope: 'No extra changes' });
    const ref = store.ledger().items[0].evidenceRefs[0];
    const trial = importTrial(store, { id: 'run-task-trial', contractId: contract.id, contractRevision: 1, runId: 'run-task', variant: 'fixture', outcome: 'verified_failure', acceptanceReviewed: true, evidenceRefs: [ref], environment: 'fixture', cacheCondition: 'unknown' });
    const foreign = { ...trial, id: 'foreign-fixture', machineId: 'different-device', outcome: 'verified_success' };
    store.db.prepare('INSERT INTO trials VALUES(?,?,?,?,?)').run(foreign.id, store.workspaceId, contract.id, 'fixture-digest', JSON.stringify(foreign));
    const view = runTask(store, { runId: 'run-task', machineId: store.machineId });
    assert.equal(view.contract!.id, contract.id); assert.equal(view.contractCount, 2);
    assert.equal(view.contract!.permittedScope, 'No extra changes'); assert.equal(view.trials.length, 1);
    assert.equal(view.trials[0].outcome, 'verified_failure'); assert.deepEqual(view.trials[0].evidenceRefs, [ref]);
    assert.equal(runTask(store, { runId: 'other-task' }).contract, null);
    assert.equal(store.summary().usage.total.value, '12');
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('run acceptance read rejects unsupported selectors and does not infer success from absent trials', () => {
  const store = new InspectorStore(':memory:');
  try {
    for (const value of [{}, { runId: 'x', path: '/private' }, { runId: 'x', machineId: null }, { runId: 'x'.repeat(1025) }]) assert.throws(() => runTask(store, value), /INVALID_RUN_TASK_QUERY/);
    const empty = runTask(store, { runId: 'unknown' }); assert.equal(empty.contract, null); assert.deepEqual(empty.trials, []);
    assert(empty.notes.some(note => note.includes('acceptance is unknown')));
  } finally { store.close(); }
});
