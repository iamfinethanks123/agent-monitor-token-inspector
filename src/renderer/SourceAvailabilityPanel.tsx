import { useEffect, useRef, useState } from 'react';
import type { InspectorBridge, SourceHealth } from '../shared/inspector';
import type { SourceAvailabilityState, SourceAvailabilityView } from '../shared/data-quality';

export function SourceAvailabilityPanel({ api, sources, limited, language }: { api: InspectorBridge; sources: Pick<SourceHealth, 'id' | 'threadId'>[]; limited: boolean; language: 'zh' | 'en' }) {
  const [data, setData] = useState<SourceAvailabilityView>(); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const epoch = useRef(0); const signature = JSON.stringify(sources.map(source => source.id));
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  useEffect(() => { epoch.current++; setData(undefined); setBusy(false); setFailed(false); return () => { epoch.current++; }; }, [signature]);
  const names: Record<SourceAvailabilityState, string> = {
    present: t('原始檔存在', 'Original file present'), missing: t('原始路徑已不存在', 'Original path missing'),
    unreadable: t('未有讀取權限', 'Read permission unavailable'), blocked: t('連結或非一般檔案；未讀取', 'Link or non-file; not inspected'),
    outside_roots: t('不在目前啟用嘅來源目錄', 'Outside enabled source roots'), root_unavailable: t('來源目錄暫時不可用', 'Source root unavailable'),
    remote: t('遠端原始檔；本機無法核對', 'Remote original; not checked locally'), not_retained: t('來源已不在保留索引', 'Source no longer retained'), unavailable: t('檔案狀態未能核對', 'File state unavailable'),
  };
  const check = async () => {
    const current = ++epoch.current; setBusy(true); setFailed(false);
    try { const result = await api.sourceAvailability(JSON.parse(signature)); if (current === epoch.current) setData(result); }
    catch { if (current === epoch.current) setFailed(true); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  const present = data?.items.filter(item => item.state === 'present').length ?? 0;
  const missing = data?.items.filter(item => item.state === 'missing').length ?? 0;
  const remote = data?.items.filter(item => item.state === 'remote').length ?? 0;
  return <section className="inspector-panel" aria-label="Original source availability"><div className="inspector-panel-heading"><div><h2>{t('原始檔案仍然可用嗎？', 'Are original source files still available?')}</h2><p>{t('保留咗統計，唔代表原始檔仍喺原位。按掣只檢查已啟用目錄內嘅檔案狀態同讀取權限。', 'Retained statistics do not establish that originals remain at their paths. This check inspects file metadata and read permission within enabled roots.')}</p></div><button className="inspector-link" disabled={busy || !sources.length} onClick={() => void check()}>{busy ? t('檢查中…', 'Checking…') : t('檢查原始檔案', 'Check original files')}</button></div>
    {failed && <p role="alert">{t('檢查未能完成；如有先前結果，保留原本檢查時間。', 'The check failed; any previous result retains its original timestamp.')}</p>}
    {data && <><div className="data-quality-metrics"><div><span>{t('原始檔存在', 'Original files present')}</span><strong>{present}</strong></div><div><span>{t('原始路徑不存在', 'Original paths missing')}</span><strong>{missing}</strong></div><div><span>{t('遠端原始檔未核對', 'Remote originals unchecked')}</span><strong>{remote}</strong></div><div><span>{t('未啟用／受限／其他未知', 'Disabled, restricted or unavailable')}</span><strong>{data.items.length - present - missing - remote}</strong></div></div>
      <p className="inspector-footnote">{t('檢查完成：', 'Check completed: ')}{new Date(data.measuredAt).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB')} · {data.items.length} {t('個來源', 'sources')}{limited && t('（全部保留來源首 200 個）', ' (first 200 retained sources)')}</p>
      <details><summary>{t('逐個來源查看結果', 'Show individual source results')}</summary><div className="inspector-table-scroll" style={{ maxHeight: 320 }}><table className="inspector-table"><thead><tr><th>{t('來源', 'Source')}</th><th>{t('目前原始檔狀態', 'Original file state')}</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{sources.find(source => source.id === item.id)?.threadId ?? item.id}</td><td>{names[item.state]}</td></tr>)}</tbody></table></div></details>
    </>}
    <p className="inspector-footnote">{t('檢查全工作區最多 200 個保留來源，唔受日期／模型篩選影響。唔會讀取檔案內容、跟隨來源連結、連入遠端、刪除統計或重新解析。檔案存在唔等於內容冇改過，亦唔證明帳戶全部歷史已收齊；結果只代表檢查時嘅狀態。', 'Checks up to 200 retained workspace sources independently of date/model filters, without reading contents, following source links, connecting remotely, deleting statistics or reparsing. Presence does not prove unchanged contents or complete account history; results describe the time of inspection.')}</p>
  </section>;
}
