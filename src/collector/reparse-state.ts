import { object,timestamp } from '../accounting/codex-observations';
import type { InspectorStore } from '../storage/InspectorStore';
import type { ReparseState } from '../shared/inspector';
export const REPARSE_STATE_KEY='reparse-operation';
/** Retained operation counts only: no source IDs, paths, traces or credentials. */
export function readReparseState(store:InspectorStore):ReparseState|null {
 const body=store.getSetting(REPARSE_STATE_KEY);if(!body)return null;
 try{
  const value=object(JSON.parse(body));if(!value||value.schemaVersion!=='reparse-operation/1'||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/.test(value.id)||!['running','completed','failed','interrupted','cancelled'].includes(String(value.state)))return null;
  if(!timestamp(value.startedAt)||!timestamp(value.updatedAt)||value.finishedAt!==null&&!timestamp(value.finishedAt)||value.state==='running'&&value.finishedAt!==null||value.state!=='running'&&value.finishedAt===null)return null;
  for(const field of ['sourcesReparsed','unavailable','revision'])if(!Number.isSafeInteger(value[field])||Number(value[field])<0)return null;
  if(value.totalSources!==null&&(!Number.isSafeInteger(value.totalSources)||Number(value.totalSources)<Number(value.sourcesReparsed)+Number(value.unavailable)))return null;
  if(value.state==='completed'&&(value.totalSources===null||Number(value.totalSources)!==Number(value.sourcesReparsed)+Number(value.unavailable)))return null;
  if(value.error!==null&&(typeof value.error!=='string'||!['REPARSE_FAILED','INDEX_UNAVAILABLE','INDEX_STOPPED','PROCESS_RESTARTED'].includes(value.error)))return null;
  return {schemaVersion:'reparse-operation/1',id:value.id,state:value.state as ReparseState['state'],startedAt:String(value.startedAt),updatedAt:String(value.updatedAt),finishedAt:value.finishedAt as string|null,totalSources:value.totalSources as number|null,sourcesReparsed:Number(value.sourcesReparsed),unavailable:Number(value.unavailable),revision:Number(value.revision),error:value.error as string|null};
 }catch{return null;}
}
export function recoverReparseState(store:InspectorStore):ReparseState|null {
 const state=readReparseState(store);if(state?.state==='running'){const now=new Date().toISOString();state.state='interrupted';state.error='PROCESS_RESTARTED';state.updatedAt=now;state.finishedAt=now;store.setSetting(REPARSE_STATE_KEY,JSON.stringify(state));}return state;
}
