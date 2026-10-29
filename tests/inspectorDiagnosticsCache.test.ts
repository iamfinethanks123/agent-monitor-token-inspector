import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { analyze } from '../src/diagnostics/analyze';
async function fixture(run:(store:InspectorStore,file:string)=>Promise<void>){const root=await mkdtemp(path.join(os.tmpdir(),'diagnostics-cache-'));const file=path.join(root,'index.sqlite');const store=new InspectorStore(file);try{const rows:unknown[]=[{type:'session_meta',payload:{id:'cache-thread',model_provider:'openai'}}];for(let index=0;index<3;index++){const at=new Date(Date.UTC(2026,9,14,0,0,index)).toISOString();rows.push({type:'response_item',timestamp:at,payload:{type:'function_call',call_id:`read-${index}`,name:'exec_command',arguments:JSON.stringify({cmd:'cat source.ts'})}},{type:'response_item',timestamp:at,payload:{type:'function_call_output',call_id:`read-${index}`,output:'x'.repeat(10000)}});}await writeFile(path.join(root,'run.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');await new IndexCollector(store,[root],'cache-fixture-key').scan();await run(store,file);}finally{store.close();await rm(root,{recursive:true,force:true});}}
test('unchanged fixed-scope reads reuse diagnostics but cannot be corrupted by caller mutations',async()=>{
 await fixture(async store=>{let lookups=0;const original=store.evidencePointer.bind(store);store.evidencePointer=id=>{lookups++;return original(id);};const first=analyze(store,{days:0});assert(lookups>0);first.findings[0].observedFacts.push('CALLER_MUTATION');lookups=0;const second=analyze(store,{limit:200,days:0});assert.equal(lookups,0);assert(!second.findings[0].observedFacts.includes('CALLER_MUTATION'));assert.notEqual(first.findings,second.findings);store.annotate(second.findings[0].id,'intentional');const changed=analyze(store,{days:0});assert(lookups>0);assert.equal(changed.findings[0].plan?.state,'review_only');});
});
test('writes from another SQLite connection invalidate cached annotations',async()=>{
 await fixture(async(store,file)=>{const first=analyze(store);const external=new DatabaseSync(file);try{external.prepare('INSERT INTO annotations(workspace_id,finding_id,choice,created_at) VALUES(?,?,?,?)').run(store.workspaceId,first.findings[0].id,'resolved',new Date().toISOString());}finally{external.close();}assert.equal(analyze(store).findings[0].annotation,'resolved');assert.equal(analyze(store).findings[0].plan?.state,'review_only');});
});
test('rolling day windows are recomputed on every read even without a database write',async()=>{
 await fixture(async store=>{let lookups=0;const original=store.evidencePointer.bind(store);store.evidencePointer=id=>{lookups++;return original(id);};const first=analyze(store,{days:366});assert.equal(first.findings.length,1);assert(lookups>0);lookups=0;const second=analyze(store,{days:366});assert(lookups>0);assert.deepEqual(second,first);});
});
