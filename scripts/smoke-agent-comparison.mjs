import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'agent-comparison-native-'));
const sources = path.join(root, 'traces'); const userData = path.join(root, 'user-data');
const executable = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
let app;
try {
  await mkdir(sources); await mkdir(path.join(userData, 'inspector'), { recursive: true });
  const now = Date.now() - 5000; const stamp = delta => new Date(now + delta).toISOString();
  for (const thread of ['comparison-root', 'comparison-child']) {
    const rows = [{ type: 'session_meta', payload: { id: thread, model_provider: 'openai', model: 'gpt-6-sol', cwd: path.join(root, 'fixture-project'), parent_thread_id: thread === 'comparison-child' ? 'comparison-root' : null, agent_role: thread === 'comparison-child' ? 'review' : 'implementation' } },
      { type: 'response_item', timestamp: stamp(0), payload: { type: 'function_call', call_id: `${thread}-call`, name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat first.ts' }) } },
      { type: 'token_usage_record', timestamp: stamp(1000), payload: { thread_id: thread, response_id: `${thread}-response`, usage: { input_tokens: 10, output_tokens: 2 } } },
      { type: 'response_item', timestamp: stamp(2000), payload: { type: 'function_call_output', call_id: `${thread}-call`, output: 'fixture output\n'.repeat(100) } }];
    await writeFile(path.join(sources, `${thread}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  // Genuine adapter/index fixtures are seeded before startup; no IPC or UI response is mocked.
  const seed = spawnSync(executable, ['--import', 'tsx', '--input-type=module', '-e', `import {InspectorStore} from './src/storage/InspectorStore.ts'; import {IndexCollector} from './src/collector/IndexCollector.ts'; const store=new InspectorStore(process.argv[1]); try { await new IndexCollector(store,[process.argv[2]],'synthetic-native-comparison-key').scan(); } finally {store.close();}`, path.join(userData, 'inspector', 'index.sqlite'), sources], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (seed.status !== 0) throw new Error(`Fixture indexing failed: ${seed.stderr}`);
  app = await electron.launch({ executablePath: executable, args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: sources, CODEX_HOME: path.join(root, 'codex-home'), HOME: path.join(root, 'home'), ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_USER_DATA: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /分析與建議|Findings/, exact: true }).click();
  await page.getByRole('navigation', { name: 'Analysis sections' }).getByRole('button', { name: /跨 Agent 比較|Agent comparison/, exact: true }).click();
  const panel = page.getByLabel('Cross-agent comparison'); await expect(panel.getByRole('heading', { name: /跨 Agent 工作比較|Cross-agent work comparison/ })).toBeVisible();
  await expect(panel.getByLabel('Shared operation groups')).toContainText(/已記錄覆核|Captured review/, { timeout: 20000 });
  await expect(panel).toContainText(/24 tokens/); await expect(panel.getByLabel('Left synchronized trace')).toContainText('exec_command');
  await panel.getByRole('button', { name: /標記刻意覆核|Mark intentional/, exact: false }).click();
  await expect(panel.getByRole('button', { name: /已標記刻意覆核|Marked intentional/ })).toBeDisabled();
  const left = await panel.getByLabel('Left comparison agent').inputValue(); const right = await panel.getByLabel('Right comparison agent').inputValue();
  const view = await page.evaluate(() => window.tokenInspector.agentComparison()); const child = view.agents.find(agent => agent.threadId === 'comparison-child');
  await panel.getByLabel(child.id === left ? 'Left agent purpose' : 'Right agent purpose').selectOption('implementation');
  await expect(panel.getByLabel('Shared operation groups')).toContainText(/可能工作重疊|Possible work overlap/);
  await panel.getByLabel('Left comparison agent').selectOption(right);
  await expect(panel.getByLabel('Shared operation groups')).toContainText(/未有可核實|No supported/);
  await panel.getByLabel('Left comparison agent').selectOption(left);
  const cursorButton = panel.getByLabel('Left synchronized trace').getByRole('button', { name: /exec_command/ });
  await cursorButton.click(); await expect(cursorButton).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByLabel('Right synchronized trace').getByRole('button', { name: /exec_command/ })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '/tmp/agent-monitor-comparison-smoke.png', fullPage: true });
  await panel.getByLabel('Left agent comparison').getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: /完整保留歷史 Timeline|Retained full-history timeline/ })).toBeVisible();
  const selectedAgent = view.agents.find(agent => agent.id === left);
  await expect(page.getByLabel('Agent scope filter')).toHaveValue(JSON.stringify([selectedAgent.machineId, selectedAgent.threadId]));
  if (errors.length) throw new Error(errors.join('; '));
  console.log('PASS: isolated native agent comparison, purpose/intentional override, synchronized cursor and Timeline navigation');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
