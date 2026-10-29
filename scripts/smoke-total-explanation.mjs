import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root=await mkdtemp(path.join(os.tmpdir(),'total-explanation-native-'));const traces=path.join(root,'traces');const userData=path.join(root,'user-data');const executable=path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');let app;
try{
  await mkdir(traces);await mkdir(path.join(userData,'inspector'),{recursive:true});
  const response=id=>({type:'token_usage_record',timestamp:'2026-10-14T01:00:00Z',payload:{thread_id:'total-native',response_id:id,usage:{input_tokens:10,output_tokens:2},private:'PRIVATE_TOTAL_NATIVE'}});
  const rows=[{type:'session_meta',payload:{id:'total-native',model_provider:'openai',model:'gpt-6-sol'}},...Array.from({length:53},(_,n)=>response(`r-${n}`)),response('r-0'),response('r-0'),...Array.from({length:2},()=>({type:'event_msg',timestamp:'2026-10-14T02:00:00Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:530,output_tokens:106}}}}))];
  await writeFile(path.join(traces,'run.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const seeded=spawnSync(executable,['--import','tsx','--input-type=module','-e',"import {InspectorStore} from './src/storage/InspectorStore.ts';import {IndexCollector} from './src/collector/IndexCollector.ts';import {setManualUsdPrice} from './src/accounting/manual-usd.ts';const s=new InspectorStore(process.argv[1]);try{await new IndexCollector(s,[process.argv[2]]).scan();setManualUsdPrice(s,{mode:'uniform',uniformRate:'2'});}finally{s.close();}",path.join(userData,'inspector','index.sqlite'),traces],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'});if(seeded.status!==0)throw new Error(seeded.stderr);
  app=await electron.launch({executablePath:executable,args:[process.cwd(),`--user-data-dir=${userData}`],env:{...process.env,AGENT_MONITOR_TRACE_ROOT:traces,AGENT_MONITOR_USER_DATA:userData,ELECTRON_USER_DATA_DIR:userData,AGENT_MONITOR_RECEIVER_PORT:'0',ELECTRON_IS_DEV:'0'}});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const open=page.getByRole('button',{name:/解釋總數|Explain this total/,exact:true});await expect(open).toBeEnabled({timeout:20000});await open.click();
  const dialog=page.getByRole('dialog',{name:/解釋總數|Explain this total/,exact:true});await expect(dialog).toContainText('636 tokens');await expect(dialog.locator('tbody tr')).toHaveCount(50);await expect(dialog).not.toContainText('PRIVATE_TOTAL_NATIVE');
  await dialog.getByRole('button',{name:/下一頁|Next/,exact:true}).click();await expect(dialog.locator('tbody tr')).toHaveCount(3);
  await dialog.getByRole('button',{name:/來源核對 57|Source evidence 57/}).click();await expect(dialog.locator('tbody tr')).toHaveCount(50);await expect(dialog).toContainText(/控制資料，唔係額外 request|Control evidence, not an extra request/);
  await dialog.getByRole('button',{name:/下一頁|Next/,exact:true}).click();await expect(dialog.locator('tbody tr')).toHaveCount(7);
  await page.screenshot({path:'/tmp/agent-monitor-total-explanation-smoke.png',fullPage:true});
  await dialog.getByRole('button',{name:/帳本成員 53|Ledger members 53/}).click();await expect(dialog.locator('tbody tr')).toHaveCount(50);await dialog.getByRole('button',{name:/解釋呢筆用量|Explain entry/,exact:true}).first().click();
  await expect(page.getByRole('dialog',{name:/解釋呢筆用量|Explain this usage entry/,exact:true})).toContainText(/來源證據|Supporting observations/);await expect(dialog).toHaveCount(0);await page.keyboard.press('Escape');
  expect((await page.evaluate(()=>window.tokenInspector.summary())).usage.total.value).toBe('636');if(errors.length)throw new Error(errors.join('; '));
  console.log('PASS: native total snapshot, complete member/source paging, non-additive controls, entry drill-down and unchanged ledger');
}finally{if(app)await app.close();await rm(root,{recursive:true,force:true});}
