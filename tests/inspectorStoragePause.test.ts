import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, unlink, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import type { InspectorStatus } from '../src/shared/inspector';
import { storageBlockReason } from '../src/collector/storage-failure';

test('native SQLite full and readonly failures require action; unrelated temporary errors do not', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-storage-errors-'));
  const filename = path.join(root, 'sample.sqlite');
  const writer = new DatabaseSync(filename);
  writer.exec('CREATE TABLE sample(value BLOB)'); writer.close();
  const reader = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.throws(() => reader.prepare('INSERT INTO sample VALUES(?)').run(Buffer.alloc(1)), error => storageBlockReason(error) === 'STORAGE_PERMISSION_REQUIRED');
    assert.equal(storageBlockReason(Object.assign(new Error('private path'), { code: 'ENOSPC' })), 'STORAGE_FULL');
    assert.equal(storageBlockReason(Object.assign(new Error('temporary'), { code: 'EBUSY' })), undefined);
  } finally { reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('collector propagates a failed storage commit without advancing its cursor or changing canonical usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-storage-cursor-'));
  const store = new InspectorStore(path.join(root, 'index.sqlite'));
  const file = path.join(root, 'run.jsonl');
  const collector = new IndexCollector(store, [root]);
  const record = (id: string) => JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'storage-cursor', response_id: id, usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n';
  try {
    await writeFile(file, record('one')); await collector.scan();
    const offset = store.sources()[0].bytesProcessed;
    await appendFile(file, record('two'));
    const full = Object.assign(new Error('PRIVATE_ERROR_PATH'), { code: 'ERR_SQLITE_ERROR', errcode: 13 });
    const commit = store.commit.bind(store); store.commit = () => { throw full; };
    await assert.rejects(collector.scan(), error => error === full);
    assert.equal(store.sources()[0].bytesProcessed, offset);
    assert.equal(store.summary().usage.total.value, '12');
    store.commit = commit; await collector.scan();
    assert.equal(store.summary().usage.total.value, '24');
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('full storage pauses automatic scans, preserves the ledger, and resumes only after manual refresh', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-storage-pause-'));
  const database = path.join(root, 'index.sqlite');
  const marker = path.join(root, 'fail');
  const countFile = path.join(root, 'scan-count');
  const entry = path.join(root, 'worker.cjs');
  let worker: Worker | undefined;
  try {
    const store = new InspectorStore(database);
    await writeFile(path.join(root, 'run.jsonl'), [
      { type: 'session_meta', payload: { id: 'storage-pause-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', payload: { thread_id: 'storage-pause-thread', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } },
    ].map(item => JSON.stringify(item)).join('\n') + '\n');
    await new IndexCollector(store, [root]).scan();
    assert.equal(store.summary().usage.total.value, '12');
    store.close();
    const limited = new DatabaseSync(':memory:');
    limited.exec('PRAGMA max_page_count=2; CREATE TABLE sample(value BLOB)');
    let failure: { code?: string; errcode?: number } = {};
    try { limited.prepare('INSERT INTO sample VALUES(?)').run(Buffer.alloc(16384)); }
    catch (error) { failure = error as typeof failure; }
    finally { limited.close(); }
    assert.equal(failure.errcode, 13);
    await writeFile(marker, 'blocked');
    await build({ entryPoints: ['src/collector/worker.ts'], outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
      plugins: [{ name: 'controlled-storage-failure', setup(builder) {
        builder.onResolve({ filter: /\/IndexCollector$/ }, () => ({ path: 'fixture', namespace: 'storage-failure' }));
        builder.onLoad({ filter: /.*/, namespace: 'storage-failure' }, () => ({ loader: 'js', contents: `
          const fs=require('node:fs');
          export class IndexCollector {
            roots; errors=[];
            constructor(_store,roots){this.roots=roots??[];}
            async scan(){const file=${JSON.stringify(countFile)};const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(count+1));if(fs.existsSync(${JSON.stringify(marker)}))throw Object.assign(new Error('PRIVATE_ERROR_TEXT'),${JSON.stringify({ code: failure.code, errcode: failure.errcode })});}
            stop(){}
            setFingerprintKey(){}
          }` }));
      } }] });
    worker = new Worker(entry, { workerData: { database, roots: [root], receiverPort: 0 } });
    let sequence = 0;
    const request = <T>(method: string) => new Promise<T>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { worker!.off('message', receive); reject(new Error('WORKER_TEST_TIMEOUT')); }, 10000);
      const receive = (message: { type: string; id: number; value: T; error?: string }) => {
        if (message.type !== 'response' || message.id !== id) return;
        clearTimeout(timer); worker!.off('message', receive);
        if (message.error) reject(new Error(message.error)); else resolve(message.value);
      };
      worker!.on('message', receive); worker!.postMessage({ id, method });
    });
    await new Promise<void>((resolve, reject) => { worker!.once('error', reject); worker!.on('message', message => { if (message.type === 'ready') resolve(); }); });
    let status = await request<InspectorStatus>('status');
    for (let i = 0; i < 20 && status.phase === 'indexing'; i++) { await new Promise(resolve => setTimeout(resolve, 25)); status = await request<InspectorStatus>('status'); }
    assert.equal(status.phase, 'degraded');
    assert.equal((status as InspectorStatus & { scanBlocked?: { reason: string } }).scanBlocked?.reason, 'STORAGE_FULL');
    assert.equal(JSON.stringify(status).includes('PRIVATE_ERROR_TEXT'), false);
    await new Promise(resolve => setTimeout(resolve, 2300));
    assert.equal(await readFile(countFile, 'utf8'), '1');
    assert.equal((await request<{ usage: { total: { value: string } } }>('summary')).usage.total.value, '12');
    await unlink(marker); await request('refresh');
    status = await request<InspectorStatus>('status');
    assert.equal(status.phase, 'ready');
    assert.equal((status as InspectorStatus & { scanBlocked?: unknown }).scanBlocked, undefined);
    assert.equal(await readFile(countFile, 'utf8'), '2');
    await new Promise(resolve => setTimeout(resolve, 2300));
    assert(Number(await readFile(countFile, 'utf8')) >= 3);
    assert.equal((await request<{ usage: { total: { value: string } } }>('summary')).usage.total.value, '12');
    await request('stop');
  } finally { await worker?.terminate(); await rm(root, { recursive: true, force: true }); }
});
