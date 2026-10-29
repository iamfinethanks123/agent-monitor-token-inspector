import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeCodex, EMPTY_CONTEXT } from '../src/accounting/codex-observations';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { inspectSourceSample } from '../src/collector/source-sample';
import { dataQuality } from '../src/diagnostics/data-quality';
const header={type:'session_meta',payload:{id:'schema-thread',model_provider:'openai'}};
const options={workspaceId:'schema-workspace',machineId:'schema-machine',sourceId:'schema-source',evidenceRef:'schema-evidence'};
const context=normalizeCodex(header,EMPTY_CONTEXT,options).context;
const record=(id:string,usage:unknown)=>({type:'token_usage_record',payload:{thread_id:'schema-thread',response_id:id,usage}});
test('renamed-only usage schemas are visibly unsupported and structurally distinct without guessed token counts',()=>{
 const first=normalizeCodex(record('renamed',{inputTokens:100,outputTokens:2}),context,options);const second=normalizeCodex(record('alias',{prompt_tokens:100,completion_tokens:2}),context,options);assert.equal(first.measurements.length,0);assert.equal(first.supported,false);assert(first.issues.includes('UNSUPPORTED_USAGE_FIELDS'));assert.notEqual(first.schemaFingerprint,second.schemaFingerprint);const mixed=normalizeCodex({...record('mixed',{inputTokens:100,outputTokens:2}),payload:{...record('mixed',{inputTokens:100,outputTokens:2}).payload,thread_token_usage:{input_tokens:10,output_tokens:2}}},context,options);assert.equal(mixed.supported,true);assert.equal(mixed.measurements.length,1);assert.equal(mixed.measurements[0].kind,'thread_counter');assert.equal(mixed.measurements[0].values.total,'12');assert(mixed.issues.includes('UNSUPPORTED_USAGE_FIELDS'));
});
test('absent or empty usage remains unknown, while recognized partial fields are retained',()=>{
 for(const value of [undefined,null,{}]){const normalized=normalizeCodex(record('pending',value),context,options);assert.equal(normalized.measurements.length,0);assert(!normalized.issues.includes('UNSUPPORTED_USAGE_FIELDS'));}
 const partial=normalizeCodex(record('partial',{input_tokens:10}),context,options);assert.equal(partial.measurements[0].values.input,'10');assert.equal(partial.measurements[0].values.output,null);
});
test('unsupported usage after a valid record downgrades source/sample quality without blocking later valid usage',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'usage-schema-'));const store=new InspectorStore(path.join(root,'index.sqlite'));try{const file=path.join(root,'run.jsonl');await writeFile(file,[header,record('first',{input_tokens:10,output_tokens:2}),record('renamed',{inputTokens:500,outputTokens:8,private_note:'PRIVATE_USAGE_SCHEMA'}),record('last',{input_tokens:10,output_tokens:2})].map(row=>JSON.stringify(row)).join('\n')+'\n');await new IndexCollector(store,[root]).scan();assert.equal(store.summary().usage.total.value,'24');assert.equal(store.summary().identifiedResponses,2);const source=store.sources()[0];assert.equal(source.state,'partial');assert(source.issues.includes('UNSUPPORTED_USAGE_FIELDS'));const quality=dataQuality(store);assert.equal(quality.counts.unsupported,1);assert.equal(quality.counts.semanticIssues,1);assert(quality.sources[0].capabilityLimited);const sample=await inspectSourceSample(file);assert.equal(sample.state,'partial');assert.equal(sample.unsupportedRecords,1);assert(sample.reasons.includes('UNSUPPORTED_OR_INVALID_RECORDS'));assert(sample.reasons.includes('UNSUPPORTED_USAGE_FIELDS'));assert(!JSON.stringify(sample).includes('PRIVATE_USAGE_SCHEMA'));assert(!JSON.stringify(quality).includes('PRIVATE_USAGE_SCHEMA'));}finally{store.close();await rm(root,{recursive:true,force:true});}
});
