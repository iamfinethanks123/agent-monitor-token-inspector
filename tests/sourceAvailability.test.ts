import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { sourceAvailability } from '../src/collector/source-availability';

async function fixture(run: (store: InspectorStore, root: string, id: string, file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'source-availability-')); const root = path.join(directory, 'traces'); await mkdir(root);
  const file = path.join(root, 'run.jsonl'); const store = new InspectorStore(path.join(directory, 'index.sqlite'));
  try {
    await writeFile(file, JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'source-availability', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n');
    await new IndexCollector(store, [root]).scan(); await run(store, root, store.sources()[0].id, file);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

test('reports missing originals without changing retained usage, revision or cursor', async () => {
  await fixture(async (store, root, id, file) => {
    const before = { total: store.summary().usage.total.value, revision: store.revision(), cursor: store.getSource(id) };
    assert.equal((await sourceAvailability(store, [root], [id])).items[0].state, 'present');
    await rm(file); const missing = await sourceAvailability(store, [root], [id]); assert.equal(missing.items[0].state, 'missing');
    assert.ok(missing.measuredAt); assert.deepEqual({ total: store.summary().usage.total.value, revision: store.revision(), cursor: store.getSource(id) }, before);
    assert.ok(!JSON.stringify(missing).includes(root));
  });
});

test('does not inspect disabled roots or treat remote statistics as locally present', async () => {
  await fixture(async (store, root, id) => {
    assert.equal((await sourceAvailability(store, [], [id])).items[0].state, 'outside_roots');
    store.db.prepare('UPDATE sources SET machine_id=? WHERE id=?').run('remote-machine', id);
    assert.equal((await sourceAvailability(store, [root], [id])).items[0].state, 'remote');
    assert.equal((await sourceAvailability(store, [root], ['unknown-source'])).items[0].state, 'not_retained');
  });
});

test('blocks source symlinks and symlink parents; unavailable roots remain explicit', async () => {
  await fixture(async (store, root, id, file) => {
    const moved = file + '.saved'; await rename(file, moved); await symlink(moved, file);
    assert.equal((await sourceAvailability(store, [root], [id])).items[0].state, 'blocked');
    await rm(file); const nested = path.join(root, 'nested'); await symlink(path.dirname(root), nested, 'dir');
    store.db.prepare('UPDATE sources SET path=? WHERE id=?').run(path.join(nested, 'outside.jsonl'), id);
    assert.equal((await sourceAvailability(store, [root], [id])).items[0].state, 'blocked');
    await rm(root, { recursive: true }); assert.equal((await sourceAvailability(store, [root], [id])).items[0].state, 'root_unavailable');
  });
});

test('bounds the request and never resolves source IDs from another workspace', async () => {
  await fixture(async (store, root, id) => {
    for (const input of [{ path: root }, [id, id], Array(201).fill(id), [12]]) await assert.rejects(sourceAvailability(store, [root], input), /INVALID_SOURCE_IDS/);
    const other = { db: store.db, workspaceId: 'other-workspace', machineId: store.machineId };
    assert.equal((await sourceAvailability(other, [root], [id])).items[0].state, 'not_retained');
  });
});
