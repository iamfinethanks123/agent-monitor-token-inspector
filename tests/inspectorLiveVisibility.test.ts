import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import type { TimelinePage } from '../src/shared/inspector';

test('100 events per second reach the Timeline interface within two seconds without idle refreshes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-visibility-'));
  const input = path.join(root, 'input'); const file = path.join(input, 'live.jsonl'); const entry = path.join(root, 'worker.cjs');
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let worker: Worker | undefined; let id = 0; let watching = false; let reading: Promise<void> | undefined; let changed = 0; let readError: Error | undefined;
  const appended = new Map<string, number>(); const visible = new Map<string, number>();
  const request = <T>(method: string, payload?: unknown) => new Promise<T>((resolve, reject) => {
    const sequence = ++id; const timer = setTimeout(() => { pending.delete(sequence); reject(new Error('VISIBILITY_QUERY_TIMEOUT')); }, 10000);
    pending.set(sequence, { resolve: value => resolve(value as T), reject, timer }); worker!.postMessage({ id: sequence, method, payload });
  });
  try {
    await mkdir(input); await writeFile(file, [
      { type: 'session_meta', payload: { id: 'visibility-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', payload: { thread_id: 'visibility-thread', response_id: 'baseline', usage: { input_tokens: 10, output_tokens: 2 } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    await build({ entryPoints: ['src/collector/worker.ts'], outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
    worker = new Worker(entry, { workerData: { database: path.join(root, 'index.sqlite'), roots: [input], receiverPort: 0 } });
    const ready = new Promise<void>((resolve, reject) => { worker!.once('error', reject); worker!.on('message', message => { if (message.type === 'ready') resolve(); if (message.type === 'initialization-error') reject(new Error('VISIBILITY_STARTUP_FAILED')); }); });
    worker.on('message', message => {
      if (message.type === 'response') { const item = pending.get(message.id); if (!item) return; clearTimeout(item.timer); pending.delete(message.id); if (message.error) item.reject(new Error(message.error)); else item.resolve(message.value); }
      if (message.type !== 'changed' || !watching) return;
      changed++; if (reading) return;
      reading = request<TimelinePage>('timeline', { runId: 'visibility-thread', direction: 'desc', limit: 200 }).then(page => {
        const now = performance.now(); for (const event of page.items) { const sent = appended.get(event.sequence); if (sent !== undefined && !visible.has(event.sequence)) visible.set(event.sequence, now - sent); }
      }).catch(error => { readError = error; }).finally(() => { reading = undefined; });
    });
    await ready; await request('refresh'); watching = true;
    const start = performance.now(); let sequence = 2;
    for (let batch = 0; batch < 50; batch++) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, start + batch * 100 - performance.now())));
      const at = new Date().toISOString(); const sent = performance.now(); const rows = [];
      for (let index = 0; index < 10; index++) { appended.set(String(++sequence), sent); rows.push({ type: 'response_item', timestamp: at, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(900) }] } }); }
      await appendFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    }
    await new Promise(resolve => setTimeout(resolve, 2100)); await reading;
    if (readError) throw readError;
    assert.equal(visible.size, 500, 'Every appended event must reach the Timeline interface through automatic change notifications');
    const timings = [...visible.values()].sort((a, b) => a - b); const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
    assert(p95Ms < 2000, `Timeline interface p95 ${p95Ms.toFixed(1)}ms exceeds two seconds`);
    assert.equal((await request<{ usage: { total: { value: string } } }>('summary')).usage.total.value, '12');
    const quiet = changed; await new Promise(resolve => setTimeout(resolve, 3100)); assert.equal(changed, quiet, 'Unchanged files must not trigger data refreshes');
    console.log(JSON.stringify({ visibilityScenario: 'real worker, local100events/s,500events,Timeline query interface', p50Ms: timings[249], p95Ms, maxMs: timings.at(-1), notifications: changed, quietMs: 3100, host: { logicalCpu: os.cpus().length, memoryBytes: os.totalmem() }, referenceHardwareMatches: false }));
    await request('stop');
  } finally {
    watching = false; await worker?.terminate(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('VISIBILITY_TEST_STOPPED')); } await rm(root, { recursive: true, force: true });
  }
});
