import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { REPARSE_STATE_KEY,readReparseState,recoverReparseState } from '../src/collector/reparse-state';
import type { ReparseState } from '../src/shared/inspector';
const state=():ReparseState=>({schemaVersion:'reparse-operation/1',id:randomUUID(),state:'running',startedAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:01:00Z',finishedAt:null,totalSources:4,sourcesReparsed:2,unavailable:1,revision:5,error:null});
test('restart retains partial counts as interrupted and never turns an unfinished operation into success',()=>{
 const store=new InspectorStore(':memory:');try{store.setSetting(REPARSE_STATE_KEY,JSON.stringify({...state(),path:'PRIVATE_PATH',prompt:'PRIVATE_CONTENT'}));const recovered=recoverReparseState(store)!;assert.equal(recovered.state,'interrupted');assert.equal(recovered.error,'PROCESS_RESTARTED');assert.equal(recovered.sourcesReparsed,2);assert.equal(recovered.unavailable,1);assert.equal(recovered.totalSources,4);assert(recovered.finishedAt);assert(!store.getSetting(REPARSE_STATE_KEY)!.includes('PRIVATE'));assert.deepEqual(recoverReparseState(store),recovered);assert.equal(store.summary().usage.total.value,null);}finally{store.close();}
});
test('corrupt or incomplete completion state is unavailable; a complete retained result remains readable',()=>{
 const store=new InspectorStore(':memory:');try{for(const record of [{...state(),totalSources:1},{...state(),sourcesReparsed:-1},{...state(),state:'completed',finishedAt:'2026-10-14T00:02:00Z'},{...state(),schemaVersion:'future-version'},{...state(),error:'PRIVATE_SECRET'}]){store.setSetting(REPARSE_STATE_KEY,JSON.stringify(record));assert.equal(readReparseState(store),null);}const complete={...state(),state:'completed',totalSources:3,finishedAt:'2026-10-14T00:02:00Z'};store.setSetting(REPARSE_STATE_KEY,JSON.stringify(complete));assert.deepEqual(recoverReparseState(store),complete);}finally{store.close();}
});
test('source progress accounts for successful and unavailable attempts, without changing the usage total',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'reparse-progress-'));const store=new InspectorStore(':memory:');const collector=new IndexCollector(store,[root]);try{for(const id of ['a','b'])await writeFile(path.join(root,`${id}.jsonl`),[{type:'session_meta',payload:{id,model_provider:'openai'}},{type:'token_usage_record',payload:{thread_id:id,response_id:id,usage:{input_tokens:10,output_tokens:2}}}].map(row=>JSON.stringify(row)).join('\n')+'\n');await collector.scan();await rm(path.join(root,'b.jsonl'));const progress:{success:number;unavailable:number;total:number}[]=[];collector.onReparseProgress=(result,total)=>progress.push({success:result.sourcesReparsed,unavailable:result.unavailable.length,total});const result=await collector.reparse();assert.deepEqual(progress[0],{success:0,unavailable:0,total:2});assert.deepEqual(progress.at(-1),{success:1,unavailable:1,total:2});assert.equal(result.sourcesReparsed,1);assert.equal(result.unavailable.length,1);assert.equal(store.summary().usage.total.value,'24');}finally{store.close();await rm(root,{recursive:true,force:true});}
});
