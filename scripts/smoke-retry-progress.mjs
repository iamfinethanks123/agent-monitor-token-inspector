import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'retry-progress-native-')); const sources = path.join(root, 'traces'); const userData = path.join(root, 'user-data');
const executable = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'); let app;
try {
  await mkdir(sources); await mkdir(path.join(userData, 'inspector'), { recursive: true }); const start = Date.now() - 20000; const stamp = delta => new Date(start + delta * 1000).toISOString();
  const call = (id, second, name = 'exec_command', args = { cmd: 'npm test' }) => ({ type: 'response_item', timestamp: stamp(second), payload: { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) } });
  const result = (id, second, output) => ({ type: 'response_item', timestamp: stamp(second), payload: { type: 'function_call_output', call_id: id, output } });
  const rows = [{ type: 'session_meta', payload: { id: 'retry-native', model_provider: 'openai', model: 'gpt-6-sol' } }];
  for (let i = 0; i < 3; i++) rows.push(call(`failure-${i}`, i * 3), { type: 'token_usage_record', timestamp: stamp(i * 3 + 1), payload: { thread_id: 'retry-native', response_id: `response-${i}`, usage: { input_tokens: 10, output_tokens: 2 } } }, result(`failure-${i}`, i * 3 + 2, 'Error: Expected 4, received 5\nProcess exited with code 1'));
  const file = path.join(sources, 'run.jsonl'); await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const completed = [...rows, call('success', 11), result('success', 12, 'Process exited with code 0')].map(row => { const copy = structuredClone(row); if (copy.type === 'session_meta') copy.payload.id = 'retry-resolved'; if (copy.type === 'token_usage_record') { copy.payload.thread_id = 'retry-resolved'; copy.payload.response_id += '-resolved'; } return copy; });
  await writeFile(path.join(sources, 'resolved.jsonl'), completed.map(row => JSON.stringify(row)).join('\n') + '\n');
  const seed = spawnSync(executable, ['--import', 'tsx', '--input-type=module', '-e', `import {InspectorStore} from './src/storage/InspectorStore.ts';import {IndexCollector} from './src/collector/IndexCollector.ts';const store=new InspectorStore(process.argv[1]);try{await new IndexCollector(store,[process.argv[2]],'synthetic-retry-key').scan();}finally{store.close();}`, path.join(userData, 'inspector', 'index.sqlite'), sources], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (seed.status !== 0) throw new Error(seed.stderr);
  app = await electron.launch({ executablePath: executable, args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: sources, CODEX_HOME: path.join(root, 'codex-home'), HOME: path.join(root, 'home'), ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_USER_DATA: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /分析與建議|Findings/, exact: true }).click();
  await page.getByRole('navigation', { name: 'Analysis sections' }).getByRole('button', { name: /重試進度|Retry progress/, exact: true }).click(); const panel = page.getByLabel('Retry progress analysis');
  await expect(panel).toContainText(/相同失敗反覆出現|Recurring comparable failure/, { timeout: 20000 }); await expect(panel).toContainText(/3 個嘗試|3 attempts/);
  const recurring = panel.locator('details.inspector-finding').filter({ has: page.locator('summary', { hasText: /相同失敗反覆出現|Recurring comparable failure/ }) });
  await recurring.locator('summary').click(); await expect(recurring).toContainText('36 tokens');
  await page.screenshot({ path: '/tmp/agent-monitor-retry-smoke.png', fullPage: true });
  const resolved = panel.locator('details.inspector-finding').filter({ has: page.locator('summary', { hasText: /其後命令已成功|Subsequent command succeeded/ }) });
  await expect(resolved).toContainText(/4 個嘗試|4 attempts/);
  await resolved.locator('summary').click(); await expect(resolved).toContainText(/退出碼 0 只證明|Exit code zero proves/);
  await resolved.getByRole('button', { name: 'Timeline', exact: true }).click(); await expect(page.getByRole('heading', { name: /完整保留歷史 Timeline|Retained full-history timeline/ })).toBeVisible();
  if (errors.length) throw new Error(errors.join('; '));
  console.log('PASS: isolated native retry recurrence, linked usage, observed later command success and Timeline navigation');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
