import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'ledger-explanation-native-')); const traces = path.join(root, 'traces'); const userData = path.join(root, 'user-data');
const executable = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'); let app;
try {
  await mkdir(traces); await mkdir(path.join(userData, 'inspector'), { recursive: true });
  const records = [{ type: 'session_meta', payload: { id: 'ledger-native', model_provider: 'openai', model: 'gpt-6-sol' } },
    ...Array.from({ length: 73 }, (_, n) => ({ type: 'token_usage_record', timestamp: new Date(Date.now() - 100000 + n * 1000).toISOString(), payload: { thread_id: 'ledger-native', response_id: 'entry-a', usage: { input_tokens: 10, output_tokens: 2 }, ignored_text: 'NATIVE_PRIVATE_MARKER' } })),
    { type: 'token_usage_record', payload: { thread_id: 'ledger-native', response_id: 'entry-b', usage: { input_tokens: 10, output_tokens: 2 } } }];
  await writeFile(path.join(traces, 'run.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n');
  const seeded = spawnSync(executable, ['--import','tsx','--input-type=module','-e',"import {InspectorStore} from './src/storage/InspectorStore.ts';import {IndexCollector} from './src/collector/IndexCollector.ts';import {setProjectPolicy} from './src/storage/project-privacy.ts';const store=new InspectorStore(process.argv[1]);try{await new IndexCollector(store,[process.argv[2]]).scan();setProjectPolicy(store,{projectId:'(unknown)',metadataDays:null,usageDays:null,contentDays:0,allowExports:true,allowSourcePreview:false,excluded:false});}finally{store.close();}", path.join(userData, 'inspector', 'index.sqlite'), traces], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(seeded.stderr);
  app = await electron.launch({ executablePath: executable, args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: userData, ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /用量帳本|Usage ledger/, exact: true }).click();
  const row = page.locator('.inspector-table tbody tr').filter({ has: page.getByText('entry-a', { exact: true }) });
  const open = row.getByRole('button', { name: /解釋呢筆用量|Explain entry/ }); await expect(open).toBeVisible({ timeout: 20000 });
  await open.click(); const dialog = page.getByRole('dialog', { name: /解釋呢筆用量|Explain this usage entry/, exact: true });
  await expect(dialog).toContainText(/50 \/ 73/); await expect(dialog.locator('tbody tr')).toHaveCount(50); await expect(dialog).not.toContainText('NATIVE_PRIVATE_MARKER');
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button').last()).toBeFocused();
  await dialog.getByRole('button', { name: /載入更多來源|Load more observations/ }).click(); await expect(dialog.locator('tbody tr')).toHaveCount(73); await expect(dialog).toContainText(/73 \/ 73/);
  await page.screenshot({ path: '/tmp/agent-monitor-ledger-explanation-smoke.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('24');
  await open.click(); await expect(dialog.locator('tbody tr')).toHaveCount(50); await dialog.getByRole('button', { name: 'Timeline', exact: true }).first().click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.timeline-summary')).toContainText(/1 符合範圍|1 matching/);
  await page.getByRole('button', { name: /用量帳本|Usage ledger/, exact: true }).click(); await open.click(); await expect(dialog.locator('tbody tr')).toHaveCount(50);
  await dialog.getByRole('button', { name: /原始來源預覽|Source preview/, exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Source evidence' })).toContainText(/私隱設定限制|privacy settings block/); await expect(page.locator('body')).not.toContainText('NATIVE_PRIVATE_MARKER');
  if (errors.length) throw new Error(errors.join('; '));
  console.log('PASS: native ledger explanation, 73 replay supports, unchanged 24-token total, keyboard focus/trap, single-source Timeline and denied raw preview');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
