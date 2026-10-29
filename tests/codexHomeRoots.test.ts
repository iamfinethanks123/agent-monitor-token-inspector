import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('graph and collector follow the configured Codex home without scanning its other files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-home-roots-')); const custom = path.join(root, 'custom codex'); const sessions = path.join(custom, 'sessions'); const explicit = path.join(root, 'explicit');
  const record = (id: string, input: number) => [{ type: 'session_meta', timestamp: new Date().toISOString(), payload: { id, model_provider: 'openai', thread_source: 'user' } }, { type: 'token_usage_record', timestamp: new Date().toISOString(), payload: { thread_id: id, response_id: id, usage: { input_tokens: input, output_tokens: 2 } } }].map(value => JSON.stringify(value)).join('\n') + '\n';
  try {
    await mkdir(sessions, { recursive: true }); await mkdir(explicit);
    await writeFile(path.join(sessions, 'run.jsonl'), record('custom-code-home', 10));
    await writeFile(path.join(custom, 'outside-sessions.jsonl'), record('must-not-import', 999));
    await writeFile(path.join(custom, 'auth.json'), 'PRIVATE_TEST_MARKER');
    await writeFile(path.join(explicit, 'run.jsonl'), record('explicit-root', 20));
    const filename = path.join(root, 'check.mjs'); const moduleUrl = (name: string) => JSON.stringify(pathToFileURL(path.resolve(name)).href);
    await writeFile(filename, `import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';import{defaultCodexRoots,IndexCollector}from${moduleUrl('src/collector/IndexCollector.ts')};import{InspectorStore}from${moduleUrl('src/storage/InspectorStore.ts')};import{TraceMonitor}from${moduleUrl('src/main/trace-monitor/TraceMonitor.ts')};
const mode=process.argv[2];if(mode==='default'){assert.deepEqual(defaultCodexRoots(),[path.join(os.homedir(),'.codex','sessions')]);console.log('PASS default');process.exit(0)}
const expected=${JSON.stringify(sessions)};assert.deepEqual(defaultCodexRoots(),[expected]);const store=new InspectorStore(':memory:');const collector=new IndexCollector(store,mode==='explicit'?[${JSON.stringify(explicit)}]:undefined);let monitor;
try{await collector.scan();assert.equal(store.summary().usage.total.value,mode==='explicit'?'22':'12');assert.equal(store.sources().length,1);if(mode!=='explicit'){monitor=new TraceMonitor();await monitor.start();assert.equal(monitor.snapshot().runs.length,1,'only the custom session enters graph inventory');await monitor.loadRun(monitor.snapshot().runs[0].id);assert.ok(monitor.snapshot().agents.some(a=>a.threadId==='custom-code-home'),'graph loads the same custom session');assert.ok(!monitor.snapshot().agents.some(a=>a.threadId==='must-not-import'),'non-session files stay outside graph');}console.log('PASS '+mode)}finally{await monitor?.stop();store.close()}`);
    for (const mode of ['custom', 'sessions-compat', 'explicit', 'default']) {
      const env = { ...process.env, CODEX_HOME: mode === 'sessions-compat' ? sessions : custom, CLAUDE_CONFIG_DIR: path.join(root, 'empty-claude'), PI_CODING_AGENT_DIR: path.join(root, 'empty-pi'), HERMES_HOME: path.join(root, 'empty-hermes') };
      if (mode === 'default') delete (env as Record<string, string | undefined>).CODEX_HOME;
      const result = spawnSync(process.execPath, ['--import', 'tsx', filename, mode], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, `${mode}: ${result.stderr}`); assert.match(result.stdout, new RegExp('PASS ' + mode));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
