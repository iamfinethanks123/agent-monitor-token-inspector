import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { toolActivity,toolsPage } from '../src/diagnostics/analyze';
import { report } from '../src/reporting/report';
import { setProjectPolicy } from '../src/storage/project-privacy';

test('tool activity covers the full scope, separates captured/duplicate payload from charging and respects filters',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-activity-'));const store=new InspectorStore(':memory:');
 try {
  const rows:unknown[]=[{type:'session_meta',payload:{id:'activity-thread',cwd:'/PRIVATE_ACTIVITY_PROJECT',model_provider:'openai',model:'gpt-6-sol'}}];
  for(let i=0;i<215;i++){
   rows.push({type:'response_item',timestamp:'2026-10-14T00:00:00Z',payload:{type:'function_call',call_id:`read-${i}`,name:'exec_command',arguments:JSON.stringify({cmd:'cat PRIVATE_PATH.ts'})}},
    {type:'response_item',timestamp:'2026-10-14T00:00:01Z',payload:{type:'function_call_output',call_id:`read-${i}`,output:'abcd',truncated:i===0}});
  }
  rows.push({type:'response_item',timestamp:'2026-10-14T00:01:00Z',payload:{type:'function_call',call_id:'failed',name:'exec_command',arguments:JSON.stringify({cmd:'npm test'})}},
   {type:'response_item',timestamp:'2026-10-14T00:01:02Z',payload:{type:'function_call_output',call_id:'failed',output:'exit_code:1',status:'error'}},
   {type:'response_item',timestamp:'2026-10-14T00:02:00Z',payload:{type:'function_call',call_id:'pending',name:'read_file',arguments:'{}'}},
   {type:'response_item',timestamp:'2026-10-14T00:03:00Z',payload:{type:'function_call_output',call_id:'orphan',output:'xy'}},
   {type:'token_usage_record',timestamp:'2026-10-14T00:03:00Z',payload:{thread_id:'activity-thread',response_id:'usage-a',usage:{input_tokens:100000,output_tokens:2}}});
  await writeFile(path.join(root,'run.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');await new IndexCollector(store,[root],'activity-fixture-key').scan();
  assert.equal(toolsPage(store).items.length,200);const view=toolActivity(store,{limit:1});
  assert.equal(view.totals.records,218);assert.equal(view.totals.invocations,217);assert.equal(view.totals.unpaired,2);assert.equal(view.totals.failed,1);assert.equal(view.groupCount,4);
  const reads=view.groups.find(group=>group.name==='exec_command'&&group.operation==='read')!;
  assert.equal(reads.records,215);assert.equal(reads.outputBytes,'860');assert.equal(reads.payloadEstimate,'215');assert.equal(reads.partialOutputs,1);assert.equal(reads.repeatedOutputRecords,214);assert.equal(reads.repeatedOutputBytes,'856');assert.equal(reads.comparableOutputs,215);assert.equal(reads.durationMs,'215000');assert.equal(reads.measuredDurations,215);
  assert.equal(view.totals.outputBytes,'873');assert.equal(view.totals.payloadEstimate,'219');assert(!JSON.stringify(view).includes('PRIVATE_PATH'));assert(!JSON.stringify(view).includes('activity-fixture-key'));assert.equal(store.summary().usage.total.value,'100002');
  assert.equal(toolActivity(store,{runId:'other'}).totals.records,0);assert.equal(toolActivity(store,{requestedModel:'gpt-6.1-sol'}).totals.records,0);assert.equal(toolActivity(store,{from:'2026-10-14T00:01:00Z',to:'2026-10-14T00:01:01Z'}).totals.records,0);assert.equal(toolActivity(store,{from:'2026-10-14T00:01:00Z',to:'2026-10-14T00:02:59Z'}).totals.records,2);
  for(const format of ['json','markdown','csv']){const result=report(store,{},format,{table:'tool-activity'});assert.equal(result.revision,store.revision());assert(!result.body.includes('PRIVATE_ACTIVITY_PROJECT'));assert(!result.body.includes('PRIVATE_PATH'));assert(result.body.includes('873'));assert(result.body.includes('not original log size'));}
  const exported=JSON.parse(report(store,{},'json',{table:'tool-activity'}).body);assert.deepEqual(exported.totals,view.totals);assert.equal(exported.observationRevision,view.observationRevision);
  const projectId=store.ledger().items[0].identity.projectId!;setProjectPolicy(store,{projectId,metadataDays:null,usageDays:null,contentDays:0,allowExports:false,allowSourcePreview:true,excluded:false});assert.throws(()=>report(store,{},'json',{table:'tool-activity'}),/PROJECT_EXPORT_RESTRICTED/);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('ranked group display is bounded without losing totals and CSV names cannot execute formulas',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-activity-groups-'));const store=new InspectorStore(':memory:');try{
  const rows:unknown[]=[{type:'session_meta',payload:{id:'group-thread',model_provider:'openai'}}];for(let i=0;i<23;i++)rows.push({type:'response_item',payload:{type:'function_call',call_id:`group-${i}`,name:i===22?'=1+1':`tool-${i}`,arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:`group-${i}`,output:'x'.repeat(i+1)}});await writeFile(path.join(root,'run.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');await new IndexCollector(store,[root]).scan();const view=toolActivity(store);assert.equal(view.groupCount,23);assert.equal(view.groups.length,20);assert.equal(view.totals.invocations,23);assert.equal(view.totals.outputBytes,'276');assert.equal(view.groups[0].name,'=1+1');const csv=report(store,{},'csv',{table:'tool-activity'});assert(csv.body.includes('"\'=1+1"'));assert(csv.body.includes('"aggregate"'));assert(csv.body.includes('"276"'));assert(csv.body.includes('"23","20"'));assert(csv.body.includes('"tool_identity_version"'));assert(csv.body.includes('"codex-tool/2"'));
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('conflicting outputs are excluded from payload sums; missing fields and fingerprints stay unknown',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-activity-limits-'));const store=new InspectorStore(':memory:');
 try{
  await writeFile(path.join(root,'run.jsonl'),[
   {type:'session_meta',payload:{id:'limits-thread',model_provider:'openai'}},
   {type:'response_item',payload:{type:'function_call',call_id:'conflict',name:'read_file',arguments:'{}'}},
   {type:'response_item',payload:{type:'function_call_output',call_id:'conflict',output:'first'}},
   {type:'response_item',payload:{type:'function_call_output',call_id:'conflict',output:'second'}},
   {type:'response_item',payload:{type:'function_call',call_id:'empty',name:'read_file',arguments:'{}'}},
   {type:'response_item',payload:{type:'function_call_output',call_id:'empty'}},
   {type:'response_item',payload:{type:'function_call',call_id:'huge',name:'exec_command',arguments:'{}'}},
   {type:'response_item',payload:{type:'function_call_output',call_id:'huge',output:'safe'}}
  ].map(row=>JSON.stringify(row)).join('\n')+'\n');await new IndexCollector(store,[root],'limits-fixture-key').scan();
  const row=store.db.prepare("SELECT id,output_metadata FROM tool_index WHERE call_id='huge'").get()!;const output=JSON.parse(String(row.output_metadata));output.outputBytes='9007199254740993';output.payloadTokenEstimate='2251799813685249';delete output.outputFingerprint;store.db.prepare('UPDATE tool_index SET output_metadata=? WHERE id=?').run(JSON.stringify(output),row.id);
  const view=toolActivity(store);assert.equal(view.totals.conflicted,1);assert.equal(view.totals.outputs,3);assert.equal(view.totals.measuredOutputs,1);assert.equal(view.totals.outputBytes,'9007199254740993');assert.equal(view.totals.payloadEstimate,'2251799813685249');assert.equal(view.totals.comparableOutputs,0);assert.equal(view.totals.repeatedOutputBytes,null);assert.equal(view.totals.measuredDurations,0);assert.equal(view.totals.durationMs,null);assert.equal(view.groups.find(group=>group.name==='read_file')!.outputBytes,null);assert.throws(()=>toolActivity(store,{cursor:'unexpected'}),/INVALID_CURSOR/);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('argument text is measured separately, with empty/unknown/conflicted coverage and legacy reparse',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tool-arguments-'));const store=new InspectorStore(':memory:');const file=path.join(root,'run.jsonl');
 try{
  const rows:unknown[]=[{type:'session_meta',payload:{id:'argument-thread',model_provider:'openai'}}];
  for(const [callId,input] of [['unicode','測試'],['emoji','😀'],['empty',''],['missing',undefined],['object',{private:'PRIVATE_ARGUMENT'}]] as const){
   rows.push({type:'response_item',payload:{type:callId==='emoji'?'custom_tool_call':'function_call',call_id:callId,name:callId,...(callId==='emoji'?{input}:{arguments:input})}},
    {type:'response_item',payload:{type:'function_call_output',call_id:callId,output:'x'}});
  }
  rows.push({type:'response_item',payload:{type:'function_call_output',call_id:'orphan',output:'x'}},
   {type:'response_item',payload:{type:'function_call',call_id:'conflict',name:'conflict',arguments:'PRIVATE_FIRST'}},
   {type:'response_item',payload:{type:'function_call',call_id:'conflict',name:'conflict',arguments:'PRIVATE_SECOND'}},
   {type:'token_usage_record',payload:{thread_id:'argument-thread',response_id:'usage',usage:{input_tokens:10,output_tokens:2}}});
  const original=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';await writeFile(file,original);const collector=new IndexCollector(store,[root],'argument-fixture-key');await collector.scan();
  const result=toolActivity(store);assert.equal(result.totals.invocations,6);assert.equal(result.totals.conflicted,1);assert.equal(result.totals.measuredArguments,3);assert.equal(result.totals.argumentBytes,'10');assert.equal(result.totals.argumentEstimate,'3');assert.equal(result.totals.outputBytes,'6');
  const tools=toolsPage(store).items;assert.equal(tools.find(tool=>tool.callId==='unicode')!.argumentBytes,'6');assert.equal(tools.find(tool=>tool.callId==='emoji')!.argumentBytes,'4');assert.equal(tools.find(tool=>tool.callId==='empty')!.argumentBytes,'0');assert.equal(tools.find(tool=>tool.callId==='empty')!.argumentEstimate.value,'0');for(const id of ['missing','object','orphan'])assert.equal(tools.find(tool=>tool.callId===id)!.argumentBytes,null);
  for(const format of ['json','markdown','csv']){const body=report(store,{},format,{table:'tool-activity'}).body;assert(body.includes('argumentBytes'));assert(!body.includes('PRIVATE_ARGUMENT'));assert(!body.includes('PRIVATE_FIRST'));assert(!body.includes('argument-fixture-key'));}
  const record=store.db.prepare("SELECT input_metadata FROM tool_index WHERE call_id='unicode'").get()!;const legacy=JSON.parse(String(record.input_metadata));for(const field of ['argumentBytes','argumentTokenEstimate','argumentTokenizer'])delete legacy[field];store.db.prepare("UPDATE tool_index SET input_metadata=? WHERE call_id='unicode'").run(JSON.stringify(legacy));assert.equal(toolsPage(store).items.find(tool=>tool.callId==='unicode')!.argumentBytes,null);
  await collector.reparse();assert.equal(toolActivity(store).totals.argumentBytes,'10');assert.equal(store.summary().usage.total.value,'12');assert.equal(await readFile(file,'utf8'),original);
  const huge=JSON.parse(String(store.db.prepare("SELECT input_metadata FROM tool_index WHERE call_id='unicode'").get()!.input_metadata));huge.argumentBytes='9007199254740993';huge.argumentTokenEstimate='2251799813685249';store.db.prepare("UPDATE tool_index SET input_metadata=? WHERE call_id='unicode'").run(JSON.stringify(huge));assert.equal(toolActivity(store).totals.argumentBytes,'9007199254740997');assert.equal(toolActivity(store).totals.argumentEstimate,'2251799813685250');
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
