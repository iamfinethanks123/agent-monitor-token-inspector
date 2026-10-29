import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { timeline } from '../src/storage/timeline';

const directory = process.argv[2];
const resume = process.argv[3] === 'resume';
if (!directory || !path.isAbsolute(directory)) throw new Error('ABSOLUTE_ISOLATED_DIRECTORY_REQUIRED');
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const marker = path.join(directory, 'synthetic-scale-marker.json');
if (resume) { const value = JSON.parse(await fs.readFile(marker, 'utf8')); if (value.schemaVersion !== 'synthetic-scale/1' || value.records !== 1000000) throw new Error('INVALID_SYNTHETIC_DIRECTORY'); }
else await fs.writeFile(marker, JSON.stringify({ schemaVersion: 'synthetic-scale/1', records: 1000000 }), { flag: 'wx', mode: 0o600 });
const input = path.join(directory, 'input'); if (!resume) await fs.mkdir(input, { mode: 0o700 });
const filename = path.join(input, 'million.jsonl');
const database = path.join(directory, 'index.sqlite');
const digest = createHash('sha256');
const sizes: Record<string, number> = {};
const count = 1000000;
let bytes = 0, responses = 0, malformed = 0, oversized = 0;
let generationMs: number | null = null;
let workload: { schemaVersion: string; synthetic: boolean; records: number; bytes: number; sha256: string; recordSizeCounts: Record<string, number>; malformed: number; oversized: number; responseRecords: number; expectedCanonicalTokens: string; rawContentRetention: boolean };
if (resume) {
  workload = JSON.parse(await fs.readFile(path.join(directory, 'workload.json'), 'utf8'));
  if (workload.schemaVersion !== 'synthetic-scale/1' || !workload.synthetic || workload.records !== count || workload.rawContentRetention || !/^[a-f0-9]{64}$/.test(workload.sha256)) throw new Error('INVALID_SYNTHETIC_WORKLOAD');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  if (digest.digest('hex') !== workload.sha256 || (await fs.stat(filename)).size !== workload.bytes) throw new Error('SYNTHETIC_SOURCE_CHANGED');
  bytes = workload.bytes;
} else {
const line = (index: number, target: number) => {
  const row = { type: 'response_item', timestamp: new Date(Date.UTC(2026, 9, 14) + index * 10).toISOString(), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] } };
  const empty = JSON.stringify(row); row.payload.content[0].text = 'x'.repeat(Math.max(0, target - Buffer.byteLength(empty) - 1));
  return JSON.stringify(row) + '\n';
};
const file = await fs.open(filename, 'wx', 0o600);
const generationStarted = performance.now();
try {
  let buffer: string[] = [], buffered = 0;
  for (let i = 0; i < count; i++) {
    let value;
    if (i === 0) value = JSON.stringify({ type: 'session_meta', payload: { id: 'scale-thread', model_provider: 'openai', model: 'gpt-6-sol' } }) + '\n';
    else if (i % 10000 === 9999) { value = '{SYNTHETIC_MALFORMED}\n'; malformed++; }
    else if (i % 100000 === 70001) { value = line(i, 2 * 1024 * 1024 + 1024); oversized++; }
    else if (i % 1000 === 0) { value = JSON.stringify({ type: 'token_usage_record', timestamp: new Date(Date.UTC(2026, 9, 14) + i * 10).toISOString(), ordinal: i, payload: { thread_id: 'scale-thread', response_id: `response-${i}`, usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n'; responses++; }
    else value = line(i, i % 10000 === 5001 ? 1024 * 1024 : 1024);
    const length = Buffer.byteLength(value); bytes += length; digest.update(value); sizes[String(length)] = (sizes[String(length)] ?? 0) + 1;
    buffer.push(value); buffered += length;
    if (buffered >= 1024 * 1024) { await file.writeFile(buffer.join('')); buffer = []; buffered = 0; }
  }
  if (buffer.length) await file.writeFile(buffer.join(''));
  await file.sync();
} finally { await file.close(); }
generationMs = performance.now() - generationStarted;
workload = { schemaVersion: 'synthetic-scale/1', synthetic: true, records: count, bytes, sha256: digest.digest('hex'), recordSizeCounts: sizes, malformed, oversized, responseRecords: responses, expectedCanonicalTokens: String(responses * 12), rawContentRetention: false };
await fs.writeFile(path.join(directory, 'workload.json'), JSON.stringify(workload, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ phase: 'generated', records: count, bytes, expectedCanonicalTokens: workload.expectedCanonicalTokens }));
}

let store = new InspectorStore(database);
let collector = new IndexCollector(store, [input]);
const scans: { offset: number; elapsedMs: number; peakRssBytes: number }[] = [];
const started = performance.now();
const startingRecords = store.observationCount();
const startingOffset = Number(store.sources()[0]?.bytesProcessed ?? 0);
console.log(JSON.stringify({ phase: resume ? 'resumed' : 'started', startingRecords, startingOffset }));
let offset = -1;
try {
  while (offset < bytes) {
    const before = performance.now(); await collector.scan();
    const cursor = store.sources()[0]; if (!cursor) throw new Error('SYNTHETIC_SOURCE_MISSING');
    const next = Number(cursor.bytesProcessed); if (next <= offset) throw new Error('IMPORT_DID_NOT_ADVANCE'); offset = next;
    const snapshot = { offset, elapsedMs: performance.now() - before, peakRssBytes: process.resourceUsage().maxRSS * 1024 };
    scans.push(snapshot); console.log(JSON.stringify({ phase: 'import', ...snapshot, records: store.observationCount() }));
    await fs.writeFile(path.join(directory, 'progress.json'), JSON.stringify({ phase: 'import', ...snapshot, records: store.observationCount(), scans: scans.length }), { mode: 0o600 });
  }
  const importMs = performance.now() - started;
  if (store.observationCount() !== count) throw new Error('RECORD_COUNT_MISMATCH');
  const summary = store.summary({ runId: 'scale-thread' });
  if (summary.usage.total.value !== workload.expectedCanonicalTokens) throw new Error('CANONICAL_TOTAL_MISMATCH');
  if (Number(store.db.prepare("SELECT COUNT(*) n FROM observations WHERE kind LIKE 'gap/%'").get()!.n) !== workload.malformed + workload.oversized) throw new Error('GAP_COUNT_MISMATCH');
  const measure = (query: () => unknown) => {
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) { const time = performance.now(); query(); durations.push(performance.now() - time); }
    durations.sort((a, b) => a - b);
    return { samples: durations.length, p50Ms: durations[9], p95Ms: durations[18], maxMs: durations[19] };
  };
  const timelineTimes = measure(() => { const page = timeline(store, { runId: 'scale-thread', limit: 200 }); if (page.items.length !== 200) throw new Error('PAGE_SIZE_MISMATCH'); });
  const summaryTimes = measure(() => store.summary({ runId: 'scale-thread' }));
  const revision = store.revision(), observations = store.observationCount();
  collector.stop(); store.close(); store = new InspectorStore(database); collector = new IndexCollector(store, [input]);
  await collector.scan();
  if (store.observationCount() !== observations || store.revision() !== revision || store.summary({ runId: 'scale-thread' }).usage.total.value !== workload.expectedCanonicalTokens) throw new Error('RESTART_REPLAY_MISMATCH');
  const cpu = process.cpuUsage(); const idleStarted = performance.now();
  for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 2000)); await collector.scan(); }
  const elapsed = performance.now() - idleStarted, used = process.cpuUsage(cpu);
  const idleCpuPercent = (used.user + used.system) / (elapsed * 10);
  const report = { schemaVersion: 'scale-measurement/1', measuredAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, logicalCpu: os.cpus().length, memoryBytes: String(os.totalmem()), runtime: process.version }, workload, resumed: resume, startingRecords, startingOffset, generationMs, importMs, durationScope: 'this_process_only', scans, records: observations, canonicalTokens: workload.expectedCanonicalTokens, timeline200: timelineTimes, runSummary: summaryTimes, peakRssBytes: process.resourceUsage().maxRSS * 1024, peakScope: 'this_process_only', idle: { durationMs: elapsed, scans: 5, cpuPercentOneCore: idleCpuPercent }, restartReplayPreserved: true, limits: { configuredExternally: true, intendedMemoryBytes: 256 * 1024 * 1024, intendedCpuPercent: 100 }, referenceHardwareMatches: false };
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ phase: 'complete', importMs, records: observations, canonicalTokens: report.canonicalTokens, peakRssBytes: report.peakRssBytes, timeline200: timelineTimes, runSummary: summaryTimes, idleCpuPercent }));
} finally { collector.stop(); store.close(); }
