import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { agentComparison, setAgentPurpose, annotateAgentComparison } from '../src/diagnostics/agent-comparison';
import { deleteSource } from '../src/storage/privacy';
import { report } from '../src/reporting/report';

const stamp = (second: number) => new Date(Date.UTC(2026, 9, 14, 1, 0, second)).toISOString();
function records(thread: string, parent: string | null, role: string | null, prefix: string) {
  const call = (suffix: string, file: string) => ({ type: 'response_item', timestamp: stamp(0), payload: { type: 'function_call', call_id: `${prefix}-${suffix}`, name: 'exec_command', arguments: JSON.stringify({ cmd: `cat ${file}` }) } });
  const output = (suffix: string, text: string) => ({ type: 'response_item', timestamp: stamp(2), payload: { type: 'function_call_output', call_id: `${prefix}-${suffix}`, output: text.repeat(1000) } });
  return [{ type: 'session_meta', payload: { id: thread, model_provider: 'openai', parent_thread_id: parent, agent_role: role } },
    { type: 'turn_context', payload: { model: 'gpt-6-sol', service_tier: 'fast' } }, call('a', 'first.ts'), call('b', 'second.ts'),
    { type: 'token_usage_record', timestamp: stamp(1), payload: { thread_id: thread, response_id: `${prefix}-response`, usage: { input_tokens: 10, output_tokens: 2 } } }, output('a', 'a'), output('b', 'b')];
}
async function fixture(sameCallIds = false, withKey = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-agent-comparison-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  const write = async (name: string, rows: unknown[]) => writeFile(path.join(root, name), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await write('root.jsonl', [...records('root', null, 'implementation', 'root'), { type: 'inter_agent_communication_metadata', timestamp: stamp(1), payload: { text: 'PRIVATE_HANDOFF_MARKER' } }]);
  await write('child.jsonl', records('child', 'root', 'review', sameCallIds ? 'root' : 'child'));
  const collector = new IndexCollector(store, [root], withKey ? 'synthetic-comparison-fingerprint-key' : undefined); await collector.scan();
  return { root, store, collector, write, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('distinct agent calls show common operations and an exact linked ledger union without penalizing independent review', async () => {
  const f = await fixture();
  try {
    const view = agentComparison(f.store, { query: { runId: 'root' } }); assert.equal(view.agents.length, 2); assert.equal(view.shared.length, 2);
    assert.equal(view.shared.every(group => group.classification === 'declared_review' && group.commonTarget === true && group.avoidableUsage.value === null), true);
    assert.equal(view.shared.every(group => group.associatedUsage.value === '24'), true); assert.equal(view.associatedUnionUsage.value, '24');
    assert.equal(view.agents.every(agent => agent.exclusiveUsage.value === '12' && agent.invocations === 2), true);
    assert.equal(view.left.length, 2); assert.equal(view.right.length, 2); assert.equal(view.handoffs.length, 1);
    assert.equal(JSON.stringify(view).includes('PRIVATE_HANDOFF_MARKER'), false); assert.equal(JSON.stringify(view).includes('outputFingerprint'), false);
    const child = view.agents.find(agent => agent.threadId === 'child')!; setAgentPurpose(f.store, { agentId: child.id, purpose: 'implementation' });
    const changed = agentComparison(f.store); assert.equal(changed.shared.every(group => group.classification === 'possible_overlap'), true);
    assert.equal(changed.agents.find(agent => agent.id === child.id)!.purposeOrigin, 'user_annotation');
    annotateAgentComparison(f.store, { request: {}, id: changed.shared[0].id, choice: 'intentional' }); assert.equal(agentComparison(f.store).shared[0].annotation, 'intentional');
    assert.equal(f.store.summary().usage.total.value, '24');
    const exported = JSON.parse(report(f.store, { runId: 'root' }, 'json').body);
    assert.equal(exported.agentComparison.associatedUnionUsage.value, '24'); assert.equal(exported.agentComparison.shared.length, 2);
    assert.equal(JSON.stringify(exported).includes('PRIVATE_HANDOFF_MARKER'), false);
    assert.ok(report(f.store, { runId: 'root' }, 'markdown').body.includes('Cross-agent comparison'));
    const csv = report(f.store, { runId: 'root' }, 'csv', { table: 'agent-comparison' }).body;
    assert.ok(csv.startsWith('"group_id","left_agent_id","right_agent_id"')); assert.ok(csv.includes('possible_overlap'));
  } finally { await f.close(); }
});

test('pair annotations do not transfer to a third agent and a self-comparison cannot become cross-agent work', async () => {
  const f = await fixture();
  try {
    await f.write('third.jsonl', records('third', 'root', 'research', 'third')); await f.collector.scan();
    const first = agentComparison(f.store); const root = first.agents.find(agent => agent.threadId === 'root')!;
    const child = first.agents.find(agent => agent.threadId === 'child')!; const third = first.agents.find(agent => agent.threadId === 'third')!;
    const reviewRequest = { leftAgentId: root.id, rightAgentId: child.id }; const review = agentComparison(f.store, reviewRequest);
    annotateAgentComparison(f.store, { request: reviewRequest, id: review.shared[0].id, choice: 'intentional' });
    const exploration = agentComparison(f.store, { leftAgentId: root.id, rightAgentId: third.id });
    assert.equal(exploration.shared.every(group => group.classification === 'declared_parallel' && group.annotation === null), true);
    assert.equal(agentComparison(f.store, { ...reviewRequest, focusGroupId: review.shared[1].id }).left.length, 2);
    assert.throws(() => agentComparison(f.store, { leftAgentId: root.id, rightAgentId: third.id, focusGroupId: review.shared[0].id }), /GROUP_OUT_OF_SCOPE/);
    await appendFile(path.join(f.root, 'root.jsonl'), [
      { type: 'response_item', timestamp: stamp(3), payload: { type: 'function_call', call_id: 'root-extra', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat first.ts' }) } },
      { type: 'response_item', timestamp: stamp(4), payload: { type: 'function_call_output', call_id: 'root-extra', output: 'a'.repeat(1000) } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n'); await f.collector.scan();
    assert.equal(agentComparison(f.store, { leftAgentId: root.id, rightAgentId: root.id }).shared.length, 0);
  } finally { await f.close(); }
});

test('mirrored source calls collapse and shared Call IDs across threads are not claimed as repeated execution', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'copy.jsonl'), await readFile(path.join(f.root, 'root.jsonl'))); await f.collector.scan();
    const view = agentComparison(f.store); assert.equal(view.mirroredInvocations, 2); assert.equal(view.agents.find(agent => agent.threadId === 'root')!.invocations, 2);
    assert.equal(view.shared.length, 2); assert.equal(view.associatedUnionUsage.value, '24'); assert.equal(f.store.summary().usage.total.value, '24');
    f.store.db.prepare("UPDATE tool_index SET conflicted=1 WHERE call_id LIKE 'root-%'").run();
    const conflicted = agentComparison(f.store); assert.equal(conflicted.conflictedInvocations, 2); assert.equal(conflicted.shared.length, 0);
  } finally { await f.close(); }
  const copiedHistory = await fixture(true);
  try { assert.equal(agentComparison(copiedHistory.store).shared.length, 0); } finally { await copiedHistory.close(); }
});

test('filters, missing fingerprints and source deletion preserve uncertainty and clear purpose annotations', async () => {
  const f = await fixture();
  try {
    const view = agentComparison(f.store); const child = view.agents.find(agent => agent.threadId === 'child')!;
    assert.equal(agentComparison(f.store, { query: { serviceTier: 'fast', provider: 'openai', from: stamp(0), to: stamp(3) } }).shared.length, 2);
    assert.equal(agentComparison(f.store, { query: { provider: 'unrelated' } }).agents.length, 0);
    assert.equal(agentComparison(f.store, { query: { agentId: 'root' } }).shared.length, 0);
    assert.equal(agentComparison(f.store, { query: { agentId: 'root', agentMode: 'inclusive' } }).shared.length, 2);
    assert.throws(() => agentComparison(f.store, { query: { agentId: 'root' }, leftAgentId: child.id }), /OUT_OF_SCOPE/);
    assert.throws(() => setAgentPurpose(f.store, { agentId: child.id, purpose: 'unapproved-role' }), /INVALID_AGENT_PURPOSE/);
    setAgentPurpose(f.store, { agentId: child.id, purpose: 'independent_test' }); annotateAgentComparison(f.store, { request: {}, id: view.shared[0].id, choice: 'intentional' }); const source = f.store.sources().find(source => source.threadId === 'child')!;
    deleteSource(f.store, source.id); assert.equal(f.store.getSetting(`agent-purpose:${source.id}`), null);
    assert.equal(f.store.annotation(view.shared[0].id), null); assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'comparison-annotation:%'").get()!.n, 0); assert.equal(agentComparison(f.store).agents.length, 1); assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { await f.close(); }
  const noKey = await fixture(false, false);
  try { const view = agentComparison(noKey.store); assert.equal(view.shared.length, 0); assert.equal(view.agents.every(agent => agent.fingerprintedOutputs === 0), true); assert.equal(view.associatedUnionUsage.value, null); } finally { await noKey.close(); }
});
