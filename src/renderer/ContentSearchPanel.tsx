import { useEffect, useRef, useState } from 'react';
import type { ContentSearchPage, InspectorBridge, InspectorQuery } from '../shared/inspector';
import './ContentSearchPanel.css';

export function ContentSearchPanel({ api, query, language, onTimeline }: { api: InspectorBridge; query: InspectorQuery; language: 'zh' | 'en'; onTimeline: (id: string) => void }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [text, setText] = useState(''), [submitted, setSubmitted] = useState('');
  const [data, setData] = useState<ContentSearchPage>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const load = async (search: string, cursor?: string) => {
    const current = ++epoch.current; setBusy(true); setError(''); setData(undefined);
    try { const next = await api.contentSearch({ ...query, search, cursor, limit: 50 }); if (current === epoch.current) setData(next); }
    catch (e) { if (current === epoch.current) setError((e as Error).message); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  useEffect(() => {
    void load('');
    const off = window.agentMonitor?.onPrivacyChanged?.(() => { setSubmitted(''); void load(''); });
    return () => { epoch.current++; off?.(); };
  }, [api]);
  useEffect(() => {
    if (!data?.items.length) return;
    const delay = Math.max(0, Math.min(2147483647, Math.min(...data.items.map(item => Date.parse(item.expiresAt))) - Date.now()));
    const timer = setTimeout(() => { setSubmitted(''); void load(''); }, delay);
    return () => clearTimeout(timer);
  }, [data]);
  const at = (value: string | null) => value ? new Date(value).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-US', { timeZone: 'Asia/Hong_Kong', hour12: false }) : t('來源時間未知', 'Source time unknown');
  return <section className="inspector-panel content-search-panel" aria-label="Approved local text search">
    <div className="inspector-panel-heading"><div><h2>{t('經同意嘅本機文字搜尋', 'Approved local text search')}</h2><p>{t('搜尋已保留嘅刪敏片段，沿用目前設備、Project、Agent、模型及日期範圍。', 'Search retained redacted excerpts in the current device, project, agent, model and date scope.')}</p></div><span className="inspector-badge">{t('只限本機', 'Local only')}</span></div>
    <form className="content-search-form" onSubmit={event => { event.preventDefault(); setSubmitted(text.trim()); void load(text.trim()); }}><label>{t('文字（大小寫不敏感、完整字串）', 'Text · case-insensitive literal substring')}<input aria-label="Approved text search" maxLength={256} value={text} onChange={event => setText(event.target.value)} /></label><button className="inspector-action-button" disabled={busy || !text.trim()}>{busy ? t('搜尋中…', 'Searching…') : t('搜尋已保留文字', 'Search retained text')}</button></form>
    {error && <p role="alert" className="inspector-form-error">{error.includes('CONTENT_SNAPSHOT_INVALIDATED') ? t('資料或私隱政策已改動，請重新搜尋。', 'Data or privacy policy changed. Search again.') : error}</p>}
    <p role="status" className="inspector-footnote">{data ? t(`目前範圍有 ${data.retained.toLocaleString()} 段未到期文字。`, `${data.retained.toLocaleString()} unexpired excerpts in this scope.`) : busy ? t('正在核對保留範圍…', 'Checking retained scope…') : ''}</p>
    {!busy && data && !data.retained && <p className="inspector-empty">{t('未有可搜尋片段。喺「設定與私隱」選擇已識別 Project，明確啟用本機文字保留；之後新讀取記錄先會加入。舊歷史要另行按「重新解析」。只傳統計嘅遠端設備唔包含文字。', 'No searchable excerpts. Enable local text retention for an identified project in Settings & privacy. New reads then capture excerpts; existing history needs a separate explicit reparse. Statistics-only remote devices contain no text.')}</p>}
    {submitted && data?.retained && !data.items.length ? <p className="inspector-empty">{t('呢個範圍嘅已保留片段未有相符文字；截斷或未保留嘅部分唔會被搜尋。', 'No match in the retained excerpts. Truncated or uncaptured content is not searched.')}</p> : null}
    <div className="content-search-results">{data?.items.map(item => <article key={item.id}><header><strong>{item.kind}</strong><span>{at(item.timestamp)}</span></header><p className="inspector-footnote">{item.projectId.slice(0, 24)} · {item.threadId?.slice(0, 24) ?? '—'} · {t('來源代', 'Generation')} {item.generation}</p><pre>{item.text}</pre><footer><span>{t('刪敏片段', 'Redacted excerpt')}{item.truncated ? t('・已截斷／部分文字', ' · truncated / partial text') : ''} · {t('到期', 'Expires')} {at(item.expiresAt)}</span><button className="inspector-link" onClick={() => onTimeline(item.evidenceRef)}>{t('定位來源紀錄', 'Locate source event')}</button></footer></article>)}</div>
    {data?.nextCursor && <button className="inspector-action-button" disabled={busy} onClick={() => void load(submitted, data.nextCursor ?? undefined)}>{t('下一頁相符片段', 'Next matching excerpts')}</button>}
    <p className="inspector-footnote">{t('預設關閉。每段8 KiB／每Project8 MiB／整體64 MiB或20,000段，最多30日且不超過事件保留期；達上限會移除最舊片段。片段可能仍有未識別嘅私密資料，亦唔代表完整Prompt或計費Token。文字唔加入遠端同步、統計報告或全域Metadata搜尋。', 'Off by default. Limits: 8 KiB per excerpt, 8 MiB per project, 64 MiB or 20,000 excerpts overall; up to 30 days within event retention. Oldest excerpts are removed at capacity. Redaction can miss private content; excerpts are not a complete prompt or billed tokens. Text is excluded from remote sync, statistics reports and global metadata search.')}</p>
  </section>;
}
