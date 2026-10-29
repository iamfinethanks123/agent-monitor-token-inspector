import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const root = await mkdtemp(path.join(os.tmpdir(), 'collector-home-cli-')); const custom = path.join(root, 'custom codex'); const sessions = path.join(custom, 'sessions'); const explicit = path.join(root, 'explicit');
const record = (id, input) => JSON.stringify({ type: 'token_usage_record', payload: { thread_id: id, response_id: id, usage: { input_tokens: input, output_tokens: 2 } } }) + '\n';
try {
  await mkdir(sessions, { recursive: true }); await mkdir(explicit);
  await writeFile(path.join(sessions, 'run.jsonl'), record('custom', 10)); await writeFile(path.join(custom, 'outside.jsonl'), record('outside', 999)); await writeFile(path.join(custom, 'auth.json'), 'PRIVATE_TEST_MARKER'); await writeFile(path.join(explicit, 'run.jsonl'), record('explicit', 20));
  for (const mode of ['custom', 'sessions-compat', 'explicit']) {
    const state = path.join(root, mode); const args = [path.resolve('dist-electron/collector.cjs'), 'local', ...(mode === 'explicit' ? [explicit] : []), '--once'];
    const result = spawnSync(process.execPath, args, { env: { ...process.env, CODEX_HOME: mode === 'sessions-compat' ? sessions : custom, AGENT_MONITOR_CLIENT_STATE: state }, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`); assert.match(result.stdout, /LOCAL_INDEXED/); assert.ok(!result.stdout.includes('PRIVATE_TEST_MARKER'));
    const db = new DatabaseSync(path.join(state, 'local-index.sqlite'), { readOnly: true }); let total = 0n;
    for (const row of db.prepare("SELECT l.entry FROM scope_state s CROSS JOIN ledger l ON l.scope_id=s.scope_id AND l.revision=s.active_revision WHERE l.status='selected'").iterate()) total += BigInt(JSON.parse(row.entry).usage.total.value ?? 0);
    assert.equal(total.toString(), mode === 'explicit' ? '22' : '12'); assert.equal(db.prepare('SELECT count(*) AS n FROM sources').get().n, 1); db.close();
  }
  console.log('PASS: actual packaged collector CLI honors custom Codex home, sessions compatibility and explicit-root priority; only session records indexed, no networking or credentials');
} finally { await rm(root, { recursive: true, force: true }); }
