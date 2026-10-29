import { useEffect,useState } from 'react';
import type { InspectorBridge,ReparseState } from '../shared/inspector';

export function useReparseState(api:InspectorBridge) {
 const [state,setState]=useState<ReparseState|null>(null);
 useEffect(()=>{let alive=true,epoch=0;const unsubscribe=api.onReparseProgress(next=>{epoch++;if(alive)setState(next);});const captured=epoch;void api.reparseState().then(next=>{if(alive&&epoch===captured)setState(next);}).catch(()=>{});return()=>{alive=false;unsubscribe();};},[api]);
 return state;
}
export function ReparseStatus({api,language}:{api:InspectorBridge;language:'zh'|'en'}) {
 const state=useReparseState(api);if(!state||state.state==='completed')return null;const running=state.state==='running';const t=(zh:string,en:string)=>language==='zh'?zh:en;
 return <span className={`inspector-status ${running||state.state==='cancelled'?'':'is-warning'}`} role="status" aria-label="Reparse operation status" title={new Date(state.updatedAt).toLocaleString('zh-HK',{timeZone:'Asia/Hong_Kong'})}><i/>{running?`${t('解析歷史','Reparsing')} ${state.sourcesReparsed+state.unavailable} / ${state.totalSources??'—'}`:state.state==='cancelled'?t('解析已取消','Reparse cancelled'):t('上次解析需核對','Previous reparse needs review')}</span>;
}
