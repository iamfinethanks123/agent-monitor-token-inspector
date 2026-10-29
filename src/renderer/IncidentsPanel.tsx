import { useEffect, useRef, useState } from 'react';
import type { FindingView, IncidentView, InspectorBridge, InspectorQuery } from '../shared/inspector';

export function IncidentsPanel({ api, query, language }: { api: InspectorBridge; query: InspectorQuery; language: 'zh' | 'en' }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en; const [data, setData] = useState<IncidentView>(); const [error, setError] = useState(''); const signature = JSON.stringify(query);
  const [loading, setLoading] = useState(true); const [readFailed, setReadFailed] = useState(false); const [readAt, setReadAt] = useState<string>();
  const refreshRead = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let alive = true, running = false, pending = false, epoch = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => { if (running) { pending = true; return; } running = true; const current = epoch; setLoading(true);
      try { const view = await api.incidents(JSON.parse(signature)); if (alive && current === epoch) { setData(view); setReadAt(new Date().toISOString()); setReadFailed(false); } }
      catch { if (alive && current === epoch) setReadFailed(true); }
      finally { running = false; if (alive) { setLoading(false); if (pending) { pending = false; void load(); } } }
    };
    refreshRead.current = load; void load();
    const unsubscribe = api.onChanged(() => { if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 10000); });
    const privacy = window.agentMonitor?.onPrivacyChanged?.(() => { epoch++; setData(undefined); setReadAt(undefined); setReadFailed(false); setError(''); if (timer) clearTimeout(timer); timer = undefined; void load(); });
    return () => { alive = false; epoch++; if (timer) clearTimeout(timer); unsubscribe(); privacy?.(); refreshRead.current = async () => {}; };
  }, [api, signature]);
  const refresh = () => refreshRead.current();
  const choices: NonNullable<FindingView['annotation']>[] = ['actionable', 'intentional', 'not_relevant', 'incorrect', 'resolved'];
  const labels = [t('值得處理', 'Actionable'), t('刻意／必要', 'Intentional'), t('不相關', 'Not relevant'), t('判斷不準確', 'Incorrect'), t('已解決', 'Resolved')];
  return <section className="inspector-panel" aria-label="Saved incidents"><div className="inspector-panel-heading"><div><h2>{t('持續異常及提醒記錄', 'Persistent incidents and alerts')}</h2><p>{t('同一異常保留一份記錄；30 秒觀察期，更新提醒相隔至少 5 分鐘。歷史匯入唔會通知。', 'One evolving record per incident; a 30-second warm-up and five-minute update cooldown. Historical imports do not notify.')}</p></div><button className="inspector-link" disabled={loading} onClick={() => void refresh()}>{loading ? t('讀取中…', 'Loading…') : readFailed ? t('重試讀取記錄', 'Retry records') : t('更新記錄', 'Refresh records')}</button></div>
    {error && <p role="alert" className="inspector-form-error">{error}</p>}
    {readFailed && <p role="alert">{t('保存記錄暫時未能更新。', 'Saved records could not be refreshed.')} {data && t('保留上次結果同原有讀取時間。', 'The previous result and original reading time are retained.')}</p>}
    {!data && loading && <p role="status">{t('保存記錄讀取中…', 'Loading saved records…')}</p>}
    {data && !data.items.length && <p className="inspector-empty">{t('目前範圍未有保存嘅異常記錄。', 'No persisted incidents in this scope.')}</p>}
    {readAt && <p className="inspector-footnote">{t('讀取於', 'Read at')} {new Date(readAt).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB', { timeZone: 'Asia/Hong_Kong', hour12: false })} HKT{loading ? t(' · 更新中…', ' · Updating…') : ''}</p>}
    {data?.items.map(incident => <article className="inspector-finding" key={incident.id}><header><h3>{incident.title}</h3><span className="inspector-badge">{incident.updates ? `${incident.updates} ${t('次受控提醒', 'controlled alerts')}` : incident.historical ? t('歷史記錄', 'Historical') : t('觀察／已抑制', 'Watching / suppressed')}</span></header>
      <p>{incident.occurrences} {t('次已記錄條件', 'recorded matches')} · {t('記錄版本', 'Record revision')} {incident.revision}</p><p className="inspector-footnote">{t('最近證據', 'Latest evidence')}: {incident.lastObservedAt ? new Date(incident.lastObservedAt).toLocaleString() : t('時間未知', 'Unknown time')}{incident.suppressionReasons.length ? ` · ${incident.suppressionReasons.join(' ')}` : ''}</p>
      {incident.dataIssues.length > 0 && <p className="inspector-footnote">{t('資料覆蓋／時效', 'Coverage / freshness')}: {incident.dataIssues.join(' · ')}</p>}
      <footer><select aria-label="Incident annotation" value={incident.annotation ?? ''} onChange={async e => { try { await api.annotate(incident.id, e.target.value as NonNullable<FindingView['annotation']>); await refresh(); } catch (err) { setError((err as Error).message); } }}><option value="" disabled>{t('標記', 'Annotate')}</option>{choices.map((choice, i) => <option key={choice} value={choice}>{labels[i]}</option>)}</select>
        <button className="inspector-link" onClick={async () => { try { await api.suppressAlerts({ query: incident.query, detectorId: incident.detectorId, hours: 24 }); await refresh(); } catch (e) { setError((e as Error).message); } }}>{t('呢個任務暫停同類提醒 24 小時', 'Mute this detector for this run for 24 hours')}</button>
        {query.projectId && <button className="inspector-link" onClick={async () => { try { await api.suppressAlerts({ query: { projectId: query.projectId, machineId: query.machineId }, detectorId: incident.detectorId, hours: 24 }); await refresh(); } catch (e) { setError((e as Error).message); } }}>{t('此 Project 暫停同類提醒 24 小時', 'Mute this detector for this project for 24 hours')}</button>}</footer></article>)}
    {!!data?.suppressions.length && <><h3>{t('已保存嘅提醒抑制', 'Saved alert suppressions')}</h3>{data.suppressions.map(rule => <p key={rule.id} className="inspector-footnote">{rule.detectorId} · {rule.query.runId ?? rule.query.agentId ?? rule.query.projectId} · {rule.expiresAt ? new Date(rule.expiresAt).toLocaleString() : t('不限時', 'No expiry')} <button className="inspector-link" onClick={async () => { try { await api.removeSuppression(rule.id); await refresh(); } catch (e) { setError((e as Error).message); } }}>{t('恢復提醒', 'Restore alerts')}</button></p>)}</>}
    <p className="inspector-footnote">{t('按已記錄證據時間排序；未知時間排後，唔由跨設備時間推斷因果。只喺 App 顯示提示；唔會控制 Codex、發送系統通知或推算訂閱額度耗盡時間。資料缺口同未知成本會保留。', 'Ordered by recorded evidence time, with unknown times last; cross-device clocks establish no causality. In-app advisory alerts only; no Codex control, OS notifications or quota-exhaustion predictions. Missing data and unknown costs remain visible.')}</p>
  </section>;
}
