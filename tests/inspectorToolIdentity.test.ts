import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { toolsPage,toolActivity } from '../src/diagnostics/analyze';
import { contextAttribution } from '../src/diagnostics/context-attribution';

test('rotation with a reused tool call ID preserves distinct generations and their captured payloads',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-generation-'));const store=new InspectorStore(path.join(root,'index.sqlite'));const file=path.join(root,'run.jsonl');const collector=new IndexCollector(store,[root],'generation-fixture-key');
 try{
  const lines=(output:string,command:string)=>[{type:'session_meta',payload:{id:'same-thread',model_provider:'openai'}},{type:'response_item',payload:{type:'function_call',call_id:'reused',name:'exec_command',arguments:JSON.stringify({cmd:command})}},{type:'response_item',payload:{type:'function_call_output',call_id:'reused',output}}].map(row=>JSON.stringify(row)).join('\n')+'\n';
  await writeFile(file,lines('first','cat first.ts'));await collector.scan();const first=toolsPage(store).items[0].id;
  const rewritten=lines('second','cat second.ts');await writeFile(file,rewritten);await collector.scan();const tools=toolsPage(store).items;
  assert.equal(store.sources()[0].generation,1);assert.equal(tools.length,2);assert.equal(new Set(tools.map(tool=>tool.id)).size,2);assert.deepEqual(tools.map(tool=>tool.generation).sort(),[0,1]);assert(tools.some(tool=>tool.id===first));assert(tools.every(tool=>tool.pairedBy==='provider_id'&&tool.status==='completed'));
  const totals=toolActivity(store).totals;assert.equal(totals.invocations,2);assert.equal(totals.conflicted,0);assert.equal(totals.outputBytes,'11');const context=contextAttribution(store);assert.equal(context.passiveOccurrences,2);assert.equal(context.passive.find(group=>group.origin==='project_file')!.bytes,'11');assert.equal(await readFile(file,'utf8'),rewritten);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('legacy projection rebuild uses retained current analyses without reading originals or repricing the ledger',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-identity-rebuild-'));const database=path.join(root,'index.sqlite');let store=new InspectorStore(database);const file=path.join(root,'run.jsonl');
 try{
  const rows=[{type:'session_meta',payload:{id:'rebuild-thread',model_provider:'openai'}},{type:'response_item',payload:{type:'function_call',call_id:'a',name:'read_file',arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'a',output:'known'}},{type:'token_usage_record',payload:{thread_id:'rebuild-thread',response_id:'a',usage:{input_tokens:10,output_tokens:2}}}];await writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');const collector=new IndexCollector(store,[root]);await collector.scan();await collector.reparse();
  const source=store.db.prepare("SELECT id,normalized FROM observations WHERE kind='response_item/function_call_output'").get()!;const legacy=JSON.parse(String(source.normalized));delete legacy.metadata.outputBytes;delete legacy.metadata.payloadTokenEstimate;store.db.prepare('UPDATE observations SET normalized=? WHERE id=?').run(JSON.stringify(legacy),source.id);
  store.db.prepare("UPDATE tool_index SET id='tool:legacy'").run();store.setSetting('tool_identity_version','1');const revision=store.revision();const observations=store.db.prepare('SELECT id,record_digest,normalized FROM observations ORDER BY id').all();const ledger=store.ledger().items;const epoch=store.getSetting('timeline_analysis_epoch');store.close();await rm(file);store=new InspectorStore(database);
  assert.equal(toolsPage(store).items[0].outputBytes,'5');assert(toolsPage(store).items[0].id.startsWith('tool:codex:2:'));assert.equal(store.getSetting('tool_identity_version'),'2');assert.notEqual(store.getSetting('timeline_analysis_epoch'),epoch);assert.equal(store.revision(),revision);assert.deepEqual(store.ledger().items,ledger);assert.deepEqual(store.db.prepare('SELECT id,record_digest,normalized FROM observations ORDER BY id').all(),observations);const repaired=toolsPage(store).items;const repairedEpoch=store.getSetting('timeline_analysis_epoch');store.close();store=new InspectorStore(database);assert.deepEqual(toolsPage(store).items,repaired);assert.equal(store.getSetting('timeline_analysis_epoch'),repairedEpoch);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('failed projection rebuild rolls back the previous tool index and its identity version',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-identity-rollback-'));const database=path.join(root,'index.sqlite');const store=new InspectorStore(database);
 try{
  await writeFile(path.join(root,'run.jsonl'),[{type:'session_meta',payload:{id:'rollback-thread',model_provider:'openai'}},{type:'response_item',payload:{type:'function_call',call_id:'a',name:'read_file',arguments:'{}'}}].map(row=>JSON.stringify(row)).join('\n')+'\n');await new IndexCollector(store,[root]).scan();store.db.prepare("UPDATE tool_index SET id='tool:legacy'").run();store.setSetting('tool_identity_version','1');const before=store.db.prepare('SELECT * FROM tool_index').all();store.db.prepare("UPDATE observations SET normalized='invalid-json' WHERE kind='response_item/function_call'").run();store.close();assert.throws(()=>new InspectorStore(database));const preserved=new DatabaseSync(database,{readOnly:true});try{assert.deepEqual(preserved.prepare('SELECT * FROM tool_index').all(),before);assert.equal(preserved.prepare("SELECT value FROM settings WHERE key='tool_identity_version'").get()!.value,'1');}finally{preserved.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an input from an earlier file generation cannot pair with a later output-only event',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-generation-unpaired-'));const store=new InspectorStore(':memory:');const file=path.join(root,'run.jsonl');const collector=new IndexCollector(store,[root]);
 try{
  const header={type:'session_meta',payload:{id:'same-thread',model_provider:'openai'}};await writeFile(file,[header,{type:'response_item',payload:{type:'function_call',call_id:'reused',name:'exec_command',arguments:'{}'}}].map(row=>JSON.stringify(row)).join('\n')+'\n');await collector.scan();await writeFile(file,[header,{type:'response_item',payload:{type:'function_call_output',call_id:'reused',output:'later'}}].map(row=>JSON.stringify(row)).join('\n')+'\n');await collector.scan();const tools=toolsPage(store).items;assert.equal(tools.length,2);assert(tools.every(tool=>tool.pairedBy==='unpaired'));assert.equal(toolActivity(store).totals.unpaired,2);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
