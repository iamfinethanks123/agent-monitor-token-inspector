export interface BenchmarkFile { id: string; role: 'input' | 'output'; bytes: string; sha256: string; summary?: { tests: number; passed: number; failed: number; skipped: number }; }
export interface BenchmarkExecution {
  id: string; contractId: string; contractRevision: number; suiteId: string; planDigest: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'setup_failed' | 'output_limit' | 'interrupted';
  startedAt: string; completedAt: string | null; elapsedMs: number | null; exitCode: number | null;
  inputFiles: BenchmarkFile[]; outputFiles: BenchmarkFile[]; stdoutBytes: string; stderrBytes: string;
  runtimeVersion: string; network: 'os_denied'; nodePermissions: 'guardrail'; contentRetained: false;
  acceptance: 'unreviewed'; issues: string[];
}
export interface BenchmarkPreview {
  id: string; contractId: string; contractRevision: number; suiteId: string; entry: string;
  files: { name: string; bytes: string; sha256: string }[]; args: string[]; outputs: string[];
  timeoutSeconds: number; expiresAt: string; planDigest: string;
}
