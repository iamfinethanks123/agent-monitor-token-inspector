import { useEffect, useState } from 'react';
import type { IncidentView, InspectorBridge, InspectorQuery, InspectorSummary, SourceHealth } from '../shared/inspector';
import './OverviewInsightsPanel.css';

export function OverviewInsightsPanel({ api, query, summary, sources, language, onLedger, onSources, onQuality, onFindings, onEvidence }: {
  api: InspectorBridge; query: InspectorQuery; summary?: InspectorSummary; sources?: SourceHealth[]; language: 'zh' | 'en';
  onLedger: () => void; onSources: () => void; onQuality: () => void; onFindings: () => void; onEvidence: (id: string) => void;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [saved, setSaved] = useState<{ view: IncidentView; readAt: string }>();
  const [failed, setFailed] = useState(false); const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0);
  const signature = JSON.stringify(query);
  useEffect(() => {
    let active = true, running = false, pending = false, epoch = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (running) { pending = true; return; } running = true; const current = epoch; setLoading(true);
      try { const view = await api.incidents(JSON.parse(signature)); if (active && current === epoch) { setSaved({ view, readAt: new Date().toISOString() }); setFailed(false); } }
      catch { if (active && current === epoch) setFailed(true); }
      finally { running = false; if (active) { setLoading(false); if (pending) { pending = false; void load(); } } }
    };
    void load();
    const changed = api.onChanged(() => { if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 10000); });
    const privacy = window.agentMonitor?.onPrivacyChanged?.(() => { epoch++; setSaved(undefined); setFailed(false); if (timer) clearTimeout(timer); timer = undefined; void load(); });
    return () => { active = false; if (timer) clearTimeout(timer); changed(); privacy?.(); };
  }, [api, signature, retry]);
  const count = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB');
  const at = (value: string) => new Date(value).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB', { timeZone: 'Asia/Hong_Kong', hour12: false });
  const sourceCount = (states: SourceHealth['state'][]) => sources ? sources.filter(source => states.includes(source.state)).length : undefined;
  const recent = saved?.view.items.slice(0, 3) ?? [];
  const annotation = (value: string | null | undefined) => ({ actionable: t('值得處理', 'Actionable'), intentional: t('刻意／必要', 'Intentional'), not_relevant: t('不相關', 'Not relevant'), incorrect: t('判斷不準確', 'Incorrect'), resolved: t('已解決', 'Resolved') }[value ?? ''] ?? t('未覆核', 'Unreviewed'));
  return <section className="inspector-panel overview-insights" aria-label="Overview investigation cues">
    <div className="inspector-panel-heading"><div><h2>{t('調查線索', 'Where to investigate')}</h2><p>{t('用量跟隨目前範圍；來源快照涵蓋全工作區。保存嘅發現唔代表全部異常。', 'Usage follows current filters; source snapshots cover the workspace. Saved findings do not establish the complete incident population.')}</p></div></div>
    <div className="overview-insights-columns">
      <article><h3>{t('用量覆蓋 · 目前範圍', 'Usage coverage · current filters')}</h3><dl>
        <div><dt>{t('已識別回應', 'Identified responses')}</dt><dd>{count(summary?.identifiedResponses)}</dd></div>
        <div><dt>{t('區間記錄', 'Intervals')}</dt><dd>{count(summary?.intervals)}</dd></div>
        <div><dt>{t('先前總量', 'Prior aggregates')}</dt><dd>{count(summary?.aggregates)}</dd></div>
        <div><dt>{t('已隔離成員', 'Quarantined entries')}</dt><dd>{count(summary?.quarantinedEntries)}</dd></div>
      </dl><p>{t('呢啲係帳本成員類型，唔係全部模型請求嘅覆蓋率。', 'These are ledger membership types, not coverage of every model request.')}</p><button className="inspector-link" onClick={onLedger}>{t('查看帳本成員', 'Inspect ledger membership')}</button></article>
      <article><h3>{t('來源快照 · 全工作區', 'Source snapshot · workspace')}</h3><dl>
        <div><dt>{t('保留來源', 'Retained sources')}</dt><dd>{count(sources?.length)}</dd></div>
        <div><dt>{t('目前版本', 'Current generation')}</dt><dd>{count(sourceCount(['current']))}</dd></div>
        <div><dt>{t('追趕中', 'Catching up')}</dt><dd>{count(sourceCount(['catching_up']))}</dd></div>
        <div><dt>{t('部分／需核對', 'Partial / needs review')}</dt><dd>{count(sourceCount(['partial', 'failed', 'unsupported', 'stale']))}</dd></div>
      </dl><p>{t('來源狀態唔代表 Agent 正在執行；原始檔是否仍存在要另外檢查。', 'Source state does not establish agent activity; original file availability needs a separate check.')}</p><div className="overview-insights-actions"><button className="inspector-link" onClick={onSources}>{t('設備與來源', 'Machines & sources')}</button><button className="inspector-link" onClick={onQuality}>{t('檢查資料覆蓋', 'Inspect data coverage')}</button></div></article>
      <article><h3>{t('近期已保存發現', 'Recent saved findings')}</h3>
        {failed && <p role="alert">{t('保存發現暫時未能更新。', 'Saved findings could not be refreshed.')} {saved && t('保留上次結果同時間。', 'The previous result and timestamp are retained.')} <button className="inspector-link" disabled={loading} onClick={() => setRetry(value => value + 1)}>{t('重試', 'Retry')}</button></p>}
        {!saved && loading && <p role="status">{t('讀取保存發現中…', 'Loading saved findings…')}</p>}
        {saved && !recent.length && <p>{t('目前範圍未有已保存發現；唔代表冇發生異常。', 'No saved findings match these filters; this does not establish that no incident occurred.')}</p>}
        {recent.length > 0 && <ul>{recent.map(item => <li key={item.id}><strong>{item.title}</strong><small>{annotation(item.annotation)} · {item.historical ? t('歷史記錄', 'Historical') : t('已記錄條件', 'Recorded condition')} · {item.lastObservedAt ? `${at(item.lastObservedAt)} HKT` : t('證據時間未知', 'Evidence time unknown')}</small>{item.dataIssues.length > 0 && <small>{t('來源或時間需核對', 'Source or timing needs review')}</small>}{item.evidenceRefs[0] && <button className="inspector-link" onClick={() => onEvidence(item.evidenceRefs[0])}>{t('打開證據', 'Open evidence')}</button>}</li>)}</ul>}
        {saved && <small>{t('讀取於', 'Read at')} {at(saved.readAt)} HKT{loading ? t(' · 更新中…', ' · Updating…') : ''}</small>}
        <button className="inspector-link" onClick={onFindings}>{t('查看發現記錄', 'Inspect saved findings')}</button>
      </article>
    </div>
  </section>;
}
