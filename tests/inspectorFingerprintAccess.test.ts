import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import type * as WorkspaceSecrets from '../src/main/WorkspaceSecrets';
import { mkdtemp,writeFile,appendFile,rm } from 'node:fs/promises';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { toolActivity } from '../src/diagnostics/analyze';

function harness() {
 const child=new EventEmitter() as EventEmitter&{stdout:EventEmitter;kill:(signal:string)=>void};child.stdout=new EventEmitter();const signals:string[]=[];child.kill=signal=>{signals.push(signal);};const timers=new Map<object,{callback:()=>void;delay:number}>();const module:{exports:typeof WorkspaceSecrets}={exports:{} as typeof WorkspaceSecrets};let writes=0;const app=Object.assign(new EventEmitter(),{isPackaged:true});
 const code=transformSync(readFileSync(new URL('../src/main/WorkspaceSecrets.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
 vm.runInNewContext(code,{module,exports:module.exports,process:{pid:1,platform:'darwin',execPath:'/test/app'},Buffer,require:(name:string)=>name==='electron'?{app,safeStorage:{isEncryptionAvailable:()=>true,decryptString:()=>{throw new Error('PRIVATE_DECRYPT_REASON');}}}:name==='node:child_process'?{spawn:()=>child}:name==='node:fs'?{existsSync:()=>true,readFileSync:()=>Buffer.from('ciphertext'),writeFileSync:()=>{writes++;}}:name==='node:path'?path:{},setTimeout:(callback:()=>void,delay:number)=>{const timer={};timers.set(timer,{callback,delay});return timer;},clearTimeout:(timer:object)=>{timers.delete(timer);}});
 return {...module.exports,child,timers,signals,app,writes:()=>writes};
}

test('protected helper framing accepts a split key response but public states never contain key material',async()=>{
 const h=harness();const states:unknown[]=[];const pending=h.protectedFingerprintKey(false,value=>states.push(value));const key=Buffer.alloc(32,7).toString('base64');h.child.stdout.emit('data',Buffer.from('{"phase":"keychain"}\n{"ke'));h.child.stdout.emit('data',Buffer.from('y":"'+key+'"}\n'));h.child.emit('exit',0);assert.equal(await pending,key);assert.equal(h.fingerprintAccess().state,'available');assert(!JSON.stringify(states).includes(key));assert.deepEqual(Object.keys(h.fingerprintAccess()).sort(),['phase','state']);assert.equal(h.timers.size,0);
});

test('startup versus protected-access timeouts remain explicit and a user retry has a separate bounded deadline',async()=>{
 for(const phase of ['starting','keychain'] as const){const h=harness();const pending=h.protectedFingerprintKey();if(phase==='keychain')h.child.stdout.emit('data',Buffer.from('{"phase":"keychain"}\n'));const timer=[...h.timers.values()][0];assert.equal(timer.delay,3000);timer.callback();assert.equal(await pending,undefined);assert.equal(h.fingerprintAccess().state,phase==='starting'?'startup_timeout':'keychain_timeout');assert.equal(h.signals.length,1);h.child.emit('exit',0);assert.equal(h.signals.length,1);}
 const retry=harness();const pending=retry.protectedFingerprintKey(true);assert.equal([...retry.timers.values()][0].delay,60000);retry.child.stdout.emit('data',Buffer.from('{"phase":"keychain"}\n{}\n'));retry.child.emit('exit',0);assert.equal(await pending,undefined);assert.equal(retry.fingerprintAccess().state,'unavailable');
 const quitting=harness();const cancelled=quitting.protectedFingerprintKey(true);quitting.app.emit('before-quit');assert.equal(await cancelled,undefined);assert.equal(quitting.signals.length,1);assert.equal(quitting.timers.size,0);
});

test('malformed, oversize, invalid or duplicate helper payloads fail closed; unreadable ciphertext is never replaced',async()=>{
 const key=Buffer.alloc(32,3).toString('base64');for(const body of ['[]\n','{"key":"PRIVATE_INVALID"}\n','x'.repeat(1025),'{"key":"'+key+'"}\n{"key":"'+key+'"}\n']){const h=harness();const pending=h.protectedFingerprintKey();h.child.stdout.emit('data',Buffer.from(body));assert.equal(await pending,undefined);assert.equal(h.fingerprintAccess().state,'failed');assert(!JSON.stringify(h.fingerprintAccess()).includes('PRIVATE'));}
 const h=harness();assert.equal(h.workspaceFingerprintKey('/test/owned'),undefined);assert.equal(h.writes(),0);
});

test('a recovered key applies only to newly collected records; previous observations and token accounting stay intact',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fingerprint-recovery-'));const store=new InspectorStore(':memory:');const collector=new IndexCollector(store,[root]);
 try{
  const file=path.join(root,'run.jsonl');const call=(id:string)=>[{type:'response_item',payload:{type:'function_call',call_id:id,name:'exec_command',arguments:JSON.stringify({cmd:'cat fixture.ts'})}},{type:'response_item',payload:{type:'function_call_output',call_id:id,output:'same'}}];const lines=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
  await writeFile(file,lines([{type:'session_meta',payload:{id:'key-recovery',model_provider:'openai'}},...call('before'),{type:'token_usage_record',payload:{thread_id:'key-recovery',response_id:'a',usage:{input_tokens:10,output_tokens:2}}}]));await collector.scan();const previous=store.db.prepare('SELECT id,normalized,record_digest FROM observations ORDER BY id').all();assert.equal(toolActivity(store).totals.comparableOutputs,0);collector.setFingerprintKey(Buffer.alloc(32,9).toString('base64'));await appendFile(file,lines([...call('after-a'),...call('after-b')]));await collector.scan();const activity=toolActivity(store);assert.equal(activity.totals.comparableOutputs,2);assert.equal(activity.totals.repeatedOutputRecords,1);assert.equal(activity.totals.repeatedOutputBytes,'4');assert.equal(store.summary().usage.total.value,'12');for(const row of previous)assert.deepEqual(store.db.prepare('SELECT id,normalized,record_digest FROM observations WHERE id=?').get(row.id),row);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
