import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { ReparseState } from '../shared/inspector';

export class InspectorService extends EventEmitter {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private initialized = false;
  private terminalError: string | undefined;
  private waiting = 0;
  private sequence = 0;
  private reparse: ReparseState | null = null;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; timeout: number; started: boolean }>();
  constructor(database: string, roots?: string[], legacyDatabase?: string, fingerprintKey?: string, receiverPort = 9897) {
    super();
    let readyResolve!: () => void; let readyReject!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    void this.ready.catch(() => undefined);
    const readyTimer = setTimeout(() => readyReject(new Error('INDEX_STARTUP_TIMEOUT')), 120000); readyTimer.unref();
    this.worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { database, roots, legacyDatabase, fingerprintKey, receiverPort } });
    this.worker.on('message', (message: { type: string; id: number; value: unknown; error?: string }) => {
      if(message.type==='reparse-progress'){this.reparse=message.value as ReparseState;this.emit('reparse-progress',structuredClone(this.reparse));return;}
      if (message.type === 'ready') { this.initialized = true; clearTimeout(readyTimer); readyResolve(); this.emit('changed'); return; }
      if (message.type === 'initialization-error') { clearTimeout(readyTimer); readyReject(new Error('INDEX_UNAVAILABLE')); this.emit('changed'); return; }
      if (message.type === 'changed') { this.emit('changed'); return; }
      if (message.type === 'devices-changed') { this.emit('devices-changed'); return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      if (message.type === 'started') {
        if (!pending.started) {
          pending.started = true; clearTimeout(pending.timer);
          pending.timer = setTimeout(() => { this.pending.delete(message.id); pending.reject(new Error('QUERY_TIMEOUT')); }, pending.timeout);
        }
        return;
      }
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
    });
    this.worker.on('error', () => { this.terminalError = 'INDEX_UNAVAILABLE'; clearTimeout(readyTimer); readyReject(new Error('INDEX_UNAVAILABLE')); this.failPending('INDEX_UNAVAILABLE'); this.emit('changed'); });
    this.worker.on('exit', code => { this.terminalError = code === 0 ? 'INDEX_STOPPED' : 'INDEX_UNAVAILABLE'; clearTimeout(readyTimer); readyReject(new Error('INDEX_STOPPED')); this.failPending(this.terminalError); });
  }
  private failPending(code: string): void {
    if(this.reparse?.state==='running'){const now=new Date().toISOString();this.reparse={...this.reparse,state:'interrupted',error:code,updatedAt:now,finishedAt:now};this.emit('reparse-progress',structuredClone(this.reparse));}
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(code)); }
    this.pending.clear();
  }
  async request(method: string, payload?: unknown): Promise<unknown> {
    if(method==='reparse-state')return structuredClone(this.reparse);
    if (this.terminalError) throw new Error(this.terminalError);
    if (this.pending.size + this.waiting >= 128) throw new Error('RATE_LIMITED');
    this.waiting++; try { if (!this.initialized) await this.ready; } finally { this.waiting--; }
    if (this.pending.size >= 128) throw new Error('RATE_LIMITED');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = method === 'reindex' ? 600000 : ['refresh', 'report', 'manual-usd', 'offline-preview', 'offline-import'].includes(method) ? 60000 : 15000;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('QUERY_QUEUE_TIMEOUT')); }, 60000);
      this.pending.set(id, { resolve, reject, timer, timeout, started: false }); this.worker.postMessage({ id, method, payload });
    });
  }
  async stop(): Promise<void> {
    await this.request('stop').catch(() => undefined);
    this.failPending('INDEX_STOPPED'); await this.worker.terminate();
  }
}
