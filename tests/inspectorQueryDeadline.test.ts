import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { transformSync } from 'esbuild';
import type { InspectorService } from '../src/main/InspectorService';

function harness(ready = true) {
  let now = 0;
  const timers = new Map<object, { at: number; callback: () => void }>();
  class TestWorker extends EventEmitter {
    static current: TestWorker;
    messages: Array<{ id: number; method: string }> = [];
    constructor() { super(); TestWorker.current = this; }
    postMessage(message: { id: number; method: string }) { this.messages.push(message); }
    async terminate() { return 0; }
  }
  const module: { exports: { InspectorService?: typeof InspectorService } } = { exports: {} };
  const code = transformSync(readFileSync(new URL('../src/main/InspectorService.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, {
    exports: module.exports, module, __dirname: '/test', structuredClone, Date,
    require: (name: string) => name === 'node:worker_threads' ? { Worker: TestWorker } : name === 'node:events' ? { EventEmitter } : path,
    setTimeout: (callback: () => void, delay: number) => {
      const timer = { unref() {} }; timers.set(timer, { at: now + delay, callback }); return timer;
    },
    clearTimeout: (timer: object) => { timers.delete(timer); },
  });
  const service = new module.exports.InspectorService!('/test/index.sqlite');
  const worker = TestWorker.current;
  if (ready) worker.emit('message', { type: 'ready' });
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [timer, entry] of [...timers]) if (entry.at <= now) { timers.delete(timer); entry.callback(); }
  };
  return { service, worker, advance };
}

test('simple queries behind other work receive their own execution deadline', async () => {
  const { service, worker, advance } = harness();
  const requests = Array.from({ length: 20 }, () => service.request('prices').then(value => value, error => error.message));
  await Promise.resolve();
  for (const message of worker.messages) {
    worker.emit('message', { type: 'started', id: message.id });
    advance(1000);
    worker.emit('message', { type: 'response', id: message.id, value: 'ok' });
  }
  assert.deepEqual(await Promise.all(requests), Array(20).fill('ok'));
});

test('started queries still time out, and late replies do not rescue them', async () => {
  const { service, worker, advance } = harness();
  const result = service.request('prices').catch(error => error.message);
  await Promise.resolve();
  const { id } = worker.messages[0];
  worker.emit('message', { type: 'started', id }); advance(10000);
  worker.emit('message', { type: 'started', id }); advance(5001);
  worker.emit('message', { type: 'response', id, value: 'late' });
  assert.equal(await result, 'QUERY_TIMEOUT');
});

test('queue waits are bounded and worker failure rejects queued requests', async () => {
  const { service, worker, advance } = harness();
  const queued = service.request('prices').catch(error => error.message);
  await Promise.resolve(); advance(60001);
  assert.equal(await queued, 'QUERY_QUEUE_TIMEOUT');
  const stopped = service.request('privacy').catch(error => error.message);
  await Promise.resolve(); worker.emit('exit', 1);
  assert.equal(await stopped, 'INDEX_UNAVAILABLE');
});

test('a late ready notification recovers new reads after the initial wait timed out', async () => {
  const { service, worker, advance } = harness(false);
  const initial = service.request('prices').catch(error => error.message);
  advance(120001); assert.equal(await initial, 'INDEX_STARTUP_TIMEOUT');
  worker.emit('message', { type: 'ready' });
  const recovered = service.request('prices'); await Promise.resolve();
  const { id } = worker.messages[0]; worker.emit('message', { type: 'started', id }); worker.emit('message', { type: 'response', id, value: 'recovered' });
  assert.equal(await recovered, 'recovered');
  worker.emit('exit', 1); assert.equal(await service.request('prices').catch(error => error.message), 'INDEX_UNAVAILABLE');
});
