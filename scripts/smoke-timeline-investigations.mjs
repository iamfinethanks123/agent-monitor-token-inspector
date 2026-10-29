import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'investigations-native-')); const sources = path.join(root, 'traces'); const userData = path.join(root, 'user-data');
const executable = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'); let app;
try {
  await mkdir(sources); await mkdir(path.join(userData, 'inspector'), { recursive: true }); const start = Date.now() - 20000; const at = second => new Date(start + second * 1000).toISOString();
  const rows = [{ type: 'session_meta', payload: { id: 'investigation-native', model_provider: 'openai', model: 'gpt-6-sol' } }];
  for (let i = 0; i < 3; i++) rows.push({ type: 'response_item', timestamp: at(i * 3), payload: { type: 'function_call', call_id: `call-${i}`, name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) } },
    { type: 'token_usage_record', timestamp: at(i * 3 + 1), payload: { thread_id: 'investigation-native', response_id: `response-${i}`, usage: { input_tokens: 10, output_tokens: 2 } } },
    { type: 'response_item', timestamp: at(i * 3 + 2), payload: { type: 'function_call_output', call_id: `call-${i}`, output: 'Error fixture\nProcess exited with code 1' } });
  rows.push({ type: 'compacted', timestamp: at(10), payload: {} }); await writeFile(path.join(sources, 'run.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\ninvalid JSON\n');
  const seeded = spawnSync(executable, ['--import','tsx','--input-type=module','-e',"import {InspectorStore} from './src/storage/InspectorStore.ts';import {IndexCollector} from './src/collector/IndexCollector.ts';const store=new InspectorStore(process.argv[1]);try{await new IndexCollector(store,[process.argv[2]],'synthetic-investigation-key').scan();}finally{store.close();}",path.join(userData, 'inspector', 'index.sqlite'),sources], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE:'1' }, encoding:'utf8' }); if (seeded.status !== 0) throw new Error(seeded.stderr);
  app = await electron.launch({ executablePath: executable, args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT:sources, CODEX_HOME:path.join(root,'codex-home'), HOME:path.join(root,'home'), ELECTRON_USER_DATA_DIR:userData, AGENT_MONITOR_USER_DATA:userData, AGENT_MONITOR_RECEIVER_PORT:'0', ELECTRON_IS_DEV:'0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror',error=>errors.push(error.message)); await page.getByRole('button',{name:/執行歷史|History/,exact:true}).click();
  const panel = page.getByLabel('Timeline investigation lanes'); await expect(panel).toContainText(/目前調查標記|Current investigation markers/); await expect(panel.getByRole('img',{name:'Investigation source-time chart'})).toBeVisible({timeout:20000});
  await page.getByLabel('Timeline source categories').getByRole('button',{name:/用量 3|Usage 3/}).click(); await expect(page.locator('.timeline-summary')).toContainText(/3 符合範圍|3 matching/);
  await page.getByLabel('Timeline source categories').getByRole('button',{name:/錯誤 3|Errors 3/}).click(); await expect(page.locator('.timeline-summary')).toContainText(/3 符合範圍|3 matching/);
  await panel.getByRole('button',{name:/Context 壓縮|Compaction/}).first().click(); await panel.getByRole('img').getByRole('button').first().click();
  await panel.getByRole('button',{name:/定位來源證據|Focus source evidence/}).click(); await expect(page.locator('.timeline-summary')).toContainText(/1 符合範圍|1 matching/);
  await page.getByRole('button',{name:/返回完整來源|Return to full source/}).click();
  await panel.getByRole('button',{name:/來源缺口|Source gaps/}).first().click(); await panel.locator('details > summary').click(); await expect(panel).toContainText(/未知來源時間區|Unknown source-time lane/);
  await panel.getByRole('button',{name:/Captured source gap|已記錄來源缺口/}).first().click(); await panel.getByRole('button',{name:/定位來源證據|Focus source evidence/}).click(); await expect(page.locator('.timeline-summary')).toContainText(/1 符合範圍|1 matching/);
  await page.screenshot({path:'/tmp/agent-monitor-investigations-smoke.png',fullPage:true}); if(errors.length)throw new Error(errors.join('; '));
  console.log('PASS: isolated native source categories, current investigation lanes, chart selection, unknown-time gap focus and return navigation');
} finally {if(app)await app.close();await rm(root,{recursive:true,force:true});}
