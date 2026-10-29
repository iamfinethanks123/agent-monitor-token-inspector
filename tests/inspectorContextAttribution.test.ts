import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { contextAttribution } from '../src/diagnostics/context-attribution';
import { observeOwnedRequest } from '../src/collector/owned-client';
import { importManifests, manifests, setManifestConsent } from '../src/storage/context-manifests';
import { deleteSource } from '../src/storage/privacy';
import { report } from '../src/reporting/report';
import type { ContextFacets, ContextManifest, ContextResult } from '../src/shared/context-manifests';

const detail = (origin: ContextFacets['origin'], state: ContextFacets['state'] = 'new', extra: Partial<ContextFacets> = {}): ContextFacets => ({ origin, state, transport: 'tool_result', media: 'text', contentId: null, originalBytes: null, included: true, serializationIncluded: false, ...extra });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-attribution-')); const store = new InspectorStore(path.join(root, 'index.sqlite')); const file = path.join(root, 'run.jsonl');
  const at = new Date().toISOString(); await writeFile(file, [
    { type: 'session_meta', payload: { id: 'context-root', model_provider: 'openai', model: 'gpt-6-sol' } },
    { type: 'response_item', timestamp: at, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PRIVATE_USER_MARKER' }, { type: 'input_image', image_url: 'PRIVATE_IMAGE_MARKER' }] } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call', call_id: 'read', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat source.ts' }) } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call_output', call_id: 'read', output: 'x'.repeat(2048), truncated: true } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call', call_id: 'instructions', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat AGENTS.md' }) } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call_output', call_id: 'instructions', output: 'instruction' } },
    { type: 'token_usage_record', payload: { thread_id: 'context-root', response_id: 'response-a', usage: { input_tokens: 5, output_tokens: 1 } } },
    { type: 'token_usage_record', payload: { thread_id: 'context-root', response_id: 'response-b', usage: { input_tokens: 8, output_tokens: 1 } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const collector = new IndexCollector(store, [root]); await collector.scan();
  return { root, store, file, collector, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('passive occurrences partition origins, preserve unknown input exposure and do not inflate a truncated payload', async () => {
  const f = await fixture();
  try {
    const view = contextAttribution(f.store); assert.equal(view.providerInput.value, '13'); assert.equal(view.passiveOccurrences, 3);
    const file = view.items.find(item => item.origin === 'project_file')!; assert.equal(file.bytes, '2048'); assert.equal(file.estimate.value, '512'); assert.equal(file.originalBytes.value, null); assert.equal(file.requestExposure.value, null); assert.equal(file.state, 'truncated');
    assert.equal(view.passive.filter(item => item.origin === 'project_file').length, 1); assert.equal(view.passive.some(item => item.origin === 'command_output'), false);
    assert.equal(view.items.find(item => item.definition === 'agent_instructions')!.classification, 'parsed_path');
    assert.equal(view.items.find(item => item.origin === 'user_instruction')!.nonTextParts.image, 1);
    assert.equal(JSON.stringify(view).includes('PRIVATE_USER_MARKER'), false); assert.equal(JSON.stringify(view).includes('PRIVATE_IMAGE_MARKER'), false);
    const first = contextAttribution(f.store, { query: { limit: 1 } }); assert.ok(first.nextCursor);
    await appendFile(f.file, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'new' }] } }) + '\n'); await f.collector.scan();
    const next = contextAttribution(f.store, { query: { limit: 1, cursor: first.nextCursor! } }); assert.equal(next.passiveOccurrences, 3);
    assert.throws(() => contextAttribution(f.store, { query: { limit: 1, cursor: first.nextCursor! }, origin: 'project_file' }), /INVALID_CURSOR/);
    const filtered = contextAttribution(f.store, { origin: 'project_file' }); assert.equal(filtered.items.length, 1); assert.equal(filtered.passiveOccurrences, 4);
    await appendFile(f.file, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'PRIVATE_IMAGE_ONLY' }] } }) + '\n'); await f.collector.scan();
    const imageOnly = contextAttribution(f.store).items.find(item => item.bytes === null)!; assert.equal(imageOnly.estimate.value, null); assert.equal(imageOnly.nonTextParts.image, 1);
    deleteSource(f.store, f.store.sources()[0].id); assert.throws(() => contextAttribution(f.store, { query: { cursor: first.nextCursor! } }), /INVALID_CURSOR/);
  } finally { await f.close(); }
});

test('schema-2 records independent facets and lineage; negative reconstruction is a discrepancy without rescaling', async () => {
  const f = await fixture();
  try {
    setManifestConsent(f.store, true); const consent = manifests(f.store).consent!; const records: (ContextManifest | ContextResult)[] = [];
    for (const [requestId, responseId, tokens] of [['request-a', 'response-a', '7'], ['request-b', 'response-b', '6']]) await observeOwnedRequest({ schema: 'owned-context/2', contextEpoch: 'epoch-a', consent, clientId: 'owned', requestId, threadId: 'context-root', turnId: null,
      items: [{ id: 'file-occurrence', origin: 'tool', text: 'data', estimate: { tokens, tokenizer: 'fixture', version: '1' }, facets: detail('project_file', requestId === 'request-a' ? 'new' : 'retained', { contentId: 'file-lineage', originalBytes: '4' }) },
        { id: 'removed', origin: 'history', text: '', facets: detail('agent_message', 'removed', { included: false, originalBytes: '100' }) }],
      persist: async record => { records.push(record); }, send: async items => { assert.deepEqual(items.map(item => item.id), ['file-occurrence']); return { responseId }; } });
    importManifests(f.store, { schema: 'owned-context-bundle/1', records }); const view = contextAttribution(f.store);
    const first = view.requests.items.find(item => item.manifest.requestId === 'request-a')!;
    assert.equal(first.discrepancy, '-2'); assert.equal(first.visibleEstimate.value, '7'); assert.equal(first.categories.length, 1); assert.equal(first.categories[0].origin, 'project_file'); assert.equal(first.reconstructionState, 'complete_estimate');
    assert.equal(view.lineage[0].requests, 2); assert.equal(view.lineage[0].estimate.value, '13'); assert.equal(view.lineage[0].evidence, 'client_declared_lineage'); assert.equal(f.store.summary().usage.total.value, '15');
    const exported = JSON.parse(report(f.store, {}, 'json').body); assert.equal(exported.contextAttribution.requests.length, 2); assert.equal(exported.contextAttribution.requests[0].manifest.consentId, undefined);
    assert.equal(exported.contextAttribution.lineage[0].requests, 2); assert.ok(report(f.store, {}, 'markdown').body.includes('Context attribution'));
    assert.ok(report(f.store, {}, 'csv', { table: 'context-origins' }).body.startsWith('"primary_origin","source_occurrences"'));
    assert.throws(() => importManifests(f.store, { schema: 'owned-context-bundle/1', records: [{ ...records[0], requestId: 'leak', text: 'PRIVATE_TEXT' }] }), /INVALID_MANIFEST/);
  } finally { await f.close(); }
});

test('multimodal and mixed tokenizer reconstructions remain unknown and duplicate response claims cannot create exposure', async () => {
  const f = await fixture();
  try {
    setManifestConsent(f.store, true); const consent = manifests(f.store).consent!; const records: (ContextManifest | ContextResult)[] = [];
    await observeOwnedRequest({ schema: 'owned-context/2', consent, clientId: 'client', requestId: 'multimodal', threadId: 'context-root', turnId: null,
      items: [{ id: 'image', origin: 'user', text: 'PRIVATE_IMAGE', facets: detail('user_instruction', 'new', { media: 'image' }) }, { id: 'text', origin: 'user', text: 'abc', facets: detail('user_instruction'), estimate: { tokens: '2', tokenizer: 'fixture', version: '1' } }],
      persist: async record => { records.push(record); }, send: async () => ({ responseId: 'response-a' }) });
    importManifests(f.store, { schema: 'owned-context-bundle/1', records }); let entry = manifests(f.store).items[0];
    assert.equal(entry.visibleEstimate.value, null); assert.equal(entry.knownTextEstimate.value, '2'); assert.equal(entry.reconstructionState, 'nontext_unestimated'); assert.equal(entry.discrepancy, null); assert.equal(entry.manifest.items[0].bytes, null); assert.equal(JSON.stringify(entry).includes('PRIVATE_IMAGE'), false);
    importManifests(f.store, { schema: 'owned-context-bundle/1', records: [{ ...records[0], requestId: 'duplicate' }, { ...records[1], requestId: 'duplicate' }] });
    assert.equal(manifests(f.store).items.every(item => item.linkage === 'ambiguous' && item.observedInput.value === null), true); assert.equal(contextAttribution(f.store).lineage.length, 0);
    const mixed: (ContextManifest | ContextResult)[] = [];
    await observeOwnedRequest({ schema: 'owned-context/2', consent, clientId: 'client', requestId: 'mixed', threadId: 'context-root', turnId: null, items: [
      { id: 'one', origin: 'user', text: 'a', facets: detail('user_instruction'), estimate: { tokens: '1', tokenizer: 'one', version: '1' } },
      { id: 'two', origin: 'user', text: 'b', facets: detail('user_instruction'), estimate: { tokens: '2', tokenizer: 'two', version: '1' } },
    ], persist: async record => { mixed.push(record); }, send: async () => ({ responseId: 'response-b' }) });
    importManifests(f.store, { schema: 'owned-context-bundle/1', records: mixed }); entry = manifests(f.store).items.find(item => item.manifest.requestId === 'mixed')!;
    assert.equal(entry.reconstructionState, 'mixed_tokenizers'); assert.equal(entry.visibleEstimate.value, null); assert.equal(entry.knownTextEstimate.value, null);
    const invalid: (ContextManifest | ContextResult)[] = [];
    await assert.rejects(observeOwnedRequest({ schema: 'owned-context/2', consent, clientId: 'client', requestId: 'invalid', threadId: 'context-root', turnId: null, items: [{ id: 'bad', origin: 'tool', text: 'not removed', facets: detail('command_output', 'removed', { included: false }) }], persist: async record => { invalid.push(record); }, send: async () => { throw new Error('must not send'); } }), /INVALID_CONTEXT_FACETS/);
    assert.equal(invalid.length, 0);
  } finally { await f.close(); }
});
