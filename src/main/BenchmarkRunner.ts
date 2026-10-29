import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import type { BenchmarkExecution, BenchmarkFile, BenchmarkPreview } from '../shared/benchmark-execution';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const relative = (value: unknown): string => { if (typeof value !== 'string' || !value || value.length > 512 || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env') || ['.git','.ssh','.codex'].includes(part))) throw new Error('INVALID_BENCHMARK_PATH'); return value; };
interface Plan { preview: BenchmarkPreview; files: Map<string, Buffer>; }
export class BenchmarkRunner {
  private plans = new Map<string, Plan>(); private active = new Map<string, { child: ChildProcess; cancel: () => void }>(); private runs = new Set<Promise<BenchmarkExecution>>(); private running = false; private stopping = false;
  constructor(private runtime: string, private record: (value: BenchmarkExecution) => Promise<void>, private onChange: () => void) {}
  async prepare(filename: string, contractId: string, contractRevision: number): Promise<BenchmarkPreview> {
    if (process.platform !== 'darwin') throw new Error('LOCAL_BENCHMARK_PLATFORM_UNAVAILABLE');
    for (const [id, plan] of this.plans) if (Date.parse(plan.preview.expiresAt) < Date.now()) this.plans.delete(id);
    if (this.plans.size >= 8) throw new Error('BENCHMARK_PLAN_LIMIT');
    const stat = await fs.lstat(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error('INVALID_BENCHMARK_BUNDLE');
    const input = JSON.parse(await fs.readFile(filename, 'utf8')) as Record<string, unknown>;
    if (!input || Object.keys(input).some(key => !['schema','suiteId','entry','files','args','outputs','timeoutSeconds'].includes(key)) || input.schema !== 'local-benchmark/1' || typeof input.suiteId !== 'string' || !/^[a-zA-Z0-9:._-]{1,128}$/.test(input.suiteId) || !Array.isArray(input.files) || !input.files.length || input.files.length > 128 || !Array.isArray(input.args) || input.args.length > 32 || input.args.some(value => typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f]/.test(value)) || !Array.isArray(input.outputs) || input.outputs.length > 32 || !Number.isInteger(input.timeoutSeconds) || Number(input.timeoutSeconds) < 1 || Number(input.timeoutSeconds) > 600) throw new Error('INVALID_BENCHMARK_BUNDLE');
    const entry = relative(input.entry); if (!/\.(?:cjs|mjs|js)$/.test(entry)) throw new Error('NODE_ENTRY_REQUIRED');
    const names = input.files.map(relative); const outputs = input.outputs.map(relative); if (new Set(names).size !== names.length || !names.includes(entry) || new Set(outputs).size !== outputs.length || outputs.some(output => names.includes(output))) throw new Error('INVALID_BENCHMARK_BUNDLE');
    const directory = await fs.realpath(path.dirname(filename)); const files = new Map<string, Buffer>(); let total = 0;
    for (const name of names) {
      const file = path.join(directory, name); let current = directory;
      for (const part of name.split('/')) { current = path.join(current, part); if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('BENCHMARK_SYMLINK_DENIED'); }
      const before = await fs.stat(file); if (!before.isFile() || before.size > 8 * 1024 * 1024 || total + before.size > 32 * 1024 * 1024) throw new Error('BENCHMARK_INPUT_LIMIT');
      const bytes = await fs.readFile(file); const after = await fs.stat(file); if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) throw new Error('BENCHMARK_INPUT_CHANGED'); total += bytes.length; files.set(name, bytes);
    }
    const metadata = names.map(name => ({ name, bytes: String(files.get(name)!.length), sha256: hash(files.get(name)!) }));
    const identity = { contractId, contractRevision, suiteId: input.suiteId, entry, files: metadata, args: input.args, outputs, timeoutSeconds: input.timeoutSeconds };
    const preview: BenchmarkPreview = { ...identity, args: input.args as string[], timeoutSeconds: Number(input.timeoutSeconds), id: randomUUID(), expiresAt: new Date(Date.now() + 300000).toISOString(), planDigest: hash(JSON.stringify(identity)) };
    this.plans.set(preview.id, { preview, files }); return preview;
  }
  discard(id: string): void { this.plans.delete(id); }
  cancel(id: string): void { this.active.get(id)?.cancel(); }
  run(id: string): Promise<BenchmarkExecution> { const task = this.execute(id); this.runs.add(task); void task.then(() => this.runs.delete(task), () => this.runs.delete(task)); return task; }
  private async execute(id: string): Promise<BenchmarkExecution> {
    const plan = this.plans.get(id); if (!plan || Date.parse(plan.preview.expiresAt) < Date.now()) throw new Error('BENCHMARK_PLAN_EXPIRED');
    if (this.running) throw new Error('BENCHMARK_ALREADY_RUNNING'); this.running = true; this.plans.delete(id);
    const preview = plan.preview; const executionId = randomUUID(); const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-monitor-benchmark-'))); await fs.chmod(folder, 0o700);
    const inputRoot = path.join(folder, 'inputs'); const outputRoot = path.join(folder, 'outputs'); await fs.mkdir(inputRoot, { mode: 0o700 }); await fs.mkdir(outputRoot, { mode: 0o700 });
    const inputFiles: BenchmarkFile[] = preview.files.map((file, i) => ({ id: `input:${i + 1}`, role: 'input', bytes: file.bytes, sha256: file.sha256 }));
    const record: BenchmarkExecution = { id: executionId, contractId: preview.contractId, contractRevision: preview.contractRevision, suiteId: preview.suiteId, planDigest: preview.planDigest,
      status: 'running', startedAt: new Date().toISOString(), completedAt: null, elapsedMs: null, exitCode: null, inputFiles, outputFiles: [], stdoutBytes: '0', stderrBytes: '0', runtimeVersion: process.versions.node, network: 'os_denied', nodePermissions: 'guardrail', contentRetained: false, acceptance: 'unreviewed', issues: [] };
    const started = Date.now(); let terminal: BenchmarkExecution['status'] | null = null;
    try {
      for (const [name, bytes] of plan.files) { const file = path.join(inputRoot, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes, { mode: 0o400, flag: 'wx' }); }
      if (this.stopping) { record.status = 'cancelled'; return record; }
      await this.record(record); this.onChange();
      const profile = `(version 1)(allow default)(deny network*)(deny file-write* (require-not (subpath ${JSON.stringify(outputRoot)})))`;
      const env = { PATH: '/usr/bin:/bin', HOME: outputRoot, TMPDIR: outputRoot, LANG: 'en_US.UTF-8', ELECTRON_RUN_AS_NODE: '1', BENCHMARK_OUTPUT_DIR: outputRoot };
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, this.runtime, '--permission', `--allow-fs-read=${folder}`, `--allow-fs-write=${outputRoot}`, preview.entry, ...preview.args], { cwd: inputRoot, env, stdio: ['ignore','pipe','pipe'] });
      let cancelForce: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => { terminal = 'cancelled'; child.kill('SIGTERM'); cancelForce ??= setTimeout(() => child.kill('SIGKILL'), 5000); };
      this.active.set(executionId, { child, cancel }); this.onChange(); let stdout = 0; let stderr = 0;
      const cap = () => { if (stdout + stderr > 4 * 1024 * 1024) { terminal = 'output_limit'; child.kill('SIGTERM'); } };
      child.stdout!.on('data', chunk => { stdout += chunk.length; cap(); }); child.stderr!.on('data', chunk => { stderr += chunk.length; cap(); });
      const timeout = setTimeout(() => { terminal = 'timed_out'; child.kill('SIGTERM'); }, preview.timeoutSeconds * 1000);
      const force = setTimeout(() => { child.kill('SIGKILL'); }, (preview.timeoutSeconds + 5) * 1000);
      let code: number | null = null; let signal: NodeJS.Signals | null = null;
      try { [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => { child.once('error', reject); child.once('close', (exit, reason) => resolve([exit, reason])); }); }
      finally { clearTimeout(timeout); clearTimeout(force); if (cancelForce) clearTimeout(cancelForce); this.active.delete(executionId); }
      record.stdoutBytes = String(stdout); record.stderrBytes = String(stderr); record.exitCode = code;
      record.status = terminal ?? (signal ? 'cancelled' : code === 0 ? 'completed' : 'failed');
      for (const [i, name] of preview.outputs.entries()) {
        const file = path.join(outputRoot, name); const info = await fs.lstat(file).catch(() => null); if (!info) { record.issues.push('EXPECTED_ARTIFACT_MISSING'); continue; }
        if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) { record.issues.push('OUTPUT_ARTIFACT_REJECTED'); continue; }
        const canonical = await fs.realpath(file); if (!canonical.startsWith(`${outputRoot}${path.sep}`)) { record.issues.push('OUTPUT_ARTIFACT_REJECTED'); continue; }
        const content = await fs.readFile(canonical); const artifact: BenchmarkFile = { id: `output:${i + 1}`, role: 'output', bytes: String(info.size), sha256: hash(content) };
        if (name.endsWith('.json')) { try { const value = JSON.parse(content.toString('utf8')); const keys = ['schema','tests','passed','failed','skipped']; if (value && value.schema === 'local-test-metrics/1' && Object.keys(value).every(key => keys.includes(key)) && ['tests','passed','failed','skipped'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) && value.passed + value.failed + value.skipped === value.tests) artifact.summary = { tests: value.tests, passed: value.passed, failed: value.failed, skipped: value.skipped }; } catch { /* Other artifacts retain size/hash metadata only. */ } }
        record.outputFiles.push(artifact);
      }
      for (const [name, bytes] of plan.files) { const actual = await fs.readFile(path.join(inputRoot, name)).catch(() => null); if (!actual || hash(actual) !== hash(bytes)) record.issues.push('FROZEN_INPUT_MODIFIED'); }
    } catch { record.status = 'setup_failed'; record.issues.push('LOCAL_EXECUTION_SETUP_FAILED'); }
    finally { record.completedAt = new Date().toISOString(); record.elapsedMs = Date.now() - started; record.issues = [...new Set(record.issues)]; try { await this.record(record); this.onChange(); } finally { await fs.rm(folder, { recursive: true, force: true }); this.running = false; } }
    return record;
  }
  async stop(): Promise<void> { this.stopping = true; for (const process of this.active.values()) process.cancel(); this.plans.clear(); await Promise.allSettled([...this.runs]); }
}
