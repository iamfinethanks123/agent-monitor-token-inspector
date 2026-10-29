import { statSync } from 'node:fs';
import type { CollectorResources } from '../shared/inspector';

/** This is the monitor process, including its threads; not the monitored agents. */
export class ResourceMeter {
  private cpu = process.cpuUsage();
  private at = performance.now();
  private last?: CollectorResources;
  constructor(private readonly database: string) {}
  sample(): CollectorResources {
    const now = performance.now();
    if (this.last && now - this.at < 1000) return this.last;
    const elapsed = now - this.at; const cpu = process.cpuUsage(); const memory = process.memoryUsage();
    const bytes = (filename: string) => { try { return String(statSync(filename).size); } catch { return null; } };
    this.last = { measuredAt: new Date().toISOString(), cpuPercent: elapsed >= 10 ? Math.round((cpu.user + cpu.system - this.cpu.user - this.cpu.system) / (elapsed * 10) * 10) / 10 : null,
      processRssBytes: String(memory.rss), workerHeapUsedBytes: String(memory.heapUsed), databaseBytes: bytes(this.database),
      walBytes: bytes(`${this.database}-wal`), runtimeVersion: process.version, scope: 'monitor_process', cpuBasis: 'one_core_percent' };
    this.cpu = cpu; this.at = now; return this.last;
  }
}
