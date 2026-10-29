import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { REPARSE_STATE_KEY,readReparseState,recoverReparseState } from '../src/collector/reparse-state';

test('cancellation between sources keeps published analysis and a later reparse can complete',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'reparse-cancel-between-'));const store=new InspectorStore(':memory:');const collector=new IndexCollector(store,[root]);
 try{
  for(const id of ['a','b'])await writeFile(path.join(root,`${id}.jsonl`),[{type:'session_meta',payload:{id,model_provider:'openai'}},{type:'token_usage_record',payload:{thread_id:id,response_id:id,usage:{input_tokens:10,output_tokens:2}}}].map(row=>JSON.stringify(row)).join('\n')+'\n');
  await collector.scan();const controller=new AbortController();collector.onReparseProgress=result=>{if(result.sourcesReparsed===1)controller.abort();};const result=await collector.reparse(controller.signal);
  assert.equal(result.cancelled,true);assert.equal(result.sourcesReparsed,1);assert.equal(result.unavailable.length,0);assert.equal(store.summary().usage.total.value,'24');assert.equal(Number(store.db.prepare('SELECT COUNT(*) n FROM source_analysis').get()!.n),1);
  collector.onReparseProgress=undefined;const complete=await collector.reparse();assert.equal(complete.cancelled,undefined);assert.equal(complete.sourcesReparsed,2);assert.equal(store.summary().usage.total.value,'24');
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('cancellation during staging never publishes the unfinished source or changes original bytes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'reparse-cancel-stage-'));const store=new InspectorStore(':memory:');const collector=new IndexCollector(store,[root]);
 try{
  const file=path.join(root,'run.jsonl');const original=[{type:'session_meta',payload:{id:'stage',model_provider:'openai'}},...Array.from({length:4},(_,i)=>({type:'token_usage_record',payload:{thread_id:'stage',response_id:String(i),usage:{input_tokens:10,output_tokens:2}}}))].map(row=>JSON.stringify(row)).join('\n')+'\n';await writeFile(file,original);await collector.scan();const revision=store.revision();const controller=new AbortController();const prepare=store.db.prepare.bind(store.db);let staged=0;
  store.db.prepare=sql=>{const statement=prepare(sql);if(sql==='INSERT INTO reparse_stage VALUES(?,?)'){const run=statement.run.bind(statement);statement.run=(...args)=>{const result=Reflect.apply(run,statement,args);if(++staged===2)controller.abort();return result;};}return statement;};
  const result=await collector.reparse(controller.signal);store.db.prepare=prepare;assert.equal(staged,2);assert.equal(result.cancelled,true);assert.equal(result.sourcesReparsed,0);assert.equal(result.unavailable.length,0);assert.equal(store.revision(),revision);assert.equal(store.summary().usage.total.value,'48');assert.equal(Number(store.db.prepare("SELECT COUNT(*) n FROM sqlite_temp_master WHERE name='reparse_stage'").get()!.n),0);assert.equal(await readFile(file,'utf8'),original);
  const complete=await collector.reparse();assert.equal(complete.sourcesReparsed,1);assert.equal(store.summary().usage.total.value,'48');await collector.scan();assert.equal(store.summary().usage.total.value,'48');
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('cancelled partial operation counts survive recovery and cannot masquerade as completion',()=>{
 const store=new InspectorStore(':memory:');try{const cancelled={schemaVersion:'reparse-operation/1',id:randomUUID(),state:'cancelled',startedAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:01:00Z',finishedAt:'2026-10-14T00:01:00Z',totalSources:4,sourcesReparsed:2,unavailable:1,revision:5,error:null};store.setSetting(REPARSE_STATE_KEY,JSON.stringify(cancelled));assert.deepEqual(recoverReparseState(store),cancelled);store.setSetting(REPARSE_STATE_KEY,JSON.stringify({...cancelled,state:'completed'}));assert.equal(readReparseState(store),null);}finally{store.close();}
});
