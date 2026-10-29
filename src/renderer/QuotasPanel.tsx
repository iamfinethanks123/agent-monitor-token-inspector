import { useEffect, useState } from 'react';
import type { InspectorBridge, InspectorQuery, QuotaSnapshot, QuotaView } from '../shared/inspector';

export function QuotasPanel({ api, query, language, onEvidence }: { api: InspectorBridge; query: InspectorQuery; language: 'zh' | 'en'; onEvidence: (id: string) => void }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [data, setData] = useState<QuotaView>(); const [error, setError] = useState(''); const [history, setHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true, running = false, pending = false, epoch = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (running) { pending = true; return; } running = true; const current = epoch; setLoading(true);
      try { const next = await api.quotas(query); if (active && current === epoch) { setData(next); setError(''); } }
      catch (e) { if (active && current === epoch) setError((e as Error).message); }
      finally { running = false; if (active) { setLoading(false); if (pending) { pending = false; void load(); } } }
    };
    setData(undefined); setError(''); void load();
    const unsubscribe = api.onChanged(() => { if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 10000); });
    const privacy = window.agentMonitor?.onPrivacyChanged?.(() => { epoch++; setData(undefined); setError(''); if (timer) clearTimeout(timer); timer = undefined; void load(); });
    return () => { active = false; if (timer) clearTimeout(timer); unsubscribe(); privacy?.(); };
  }, [api, query]);
  const rows: QuotaSnapshot[] = (history ? data?.history : data?.snapshots) ?? [];
  const date = (value: string | null) => value ? new Date(value).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB', { timeZone: 'Asia/Hong_Kong', hour12: false }) : t('未知', 'Unknown');
  return <section className="inspector-panel" aria-label="Recorded quota windows"><div className="inspector-panel-heading"><div><h2>{t('記錄內嘅額度視窗', 'Recorded quota windows')}</h2><p>{t('來源記錄當時嘅百分比；帳戶身份未核實，各 Session 嘅額度唔會相加。', 'Percentages at source capture time. Account identity is unverified; session quota snapshots are never summed.')}</p></div><button className="inspector-link" onClick={() => setHistory(!history)}>{history ? t('最新快照', 'Latest snapshots') : t('最近 200 筆觀察', 'Recent 200 observations')}</button></div>{error && <p role="alert">{t('額度快照未能更新；如有先前結果，保留原有量度時間。', 'Quota refresh failed; any previous results retain their original measurement time.')} {error}</p>}
    {rows.length ? <div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>{t('來源／量度時間', 'Source / measured at')}</th><th>{t('視窗', 'Window')}</th><th>{t('已用', 'Used')}</th><th>{t('視窗長度', 'Window duration')}</th><th>{t('重設時間', 'Reset time')}</th><th>{t('證據', 'Evidence')}</th></tr></thead><tbody>{rows.flatMap(row => (['primary', 'secondary'] as const).map(kind => ({ row, kind, value: row[kind] })).filter(item => item.value !== null)).map(({ row, kind, value }) => <tr key={`${row.id}:${kind}`}><td>{row.limitId ?? t('額度識別未知', 'Unknown limit')}<small>{date(row.measuredAt)} · {row.sourceId.slice(-10)}</small></td><td>{kind}</td><td>{value!.usedPercent === null ? '—' : `${value!.usedPercent}%`}</td><td>{value!.windowMinutes === null ? t('未知', 'Unknown') : `${value!.windowMinutes} ${t('分鐘', 'minutes')}`}</td><td>{date(value!.resetsAt)}<small>{value!.issues.join(' · ')}</small></td><td><button className="inspector-link" onClick={() => onEvidence(row.evidenceRef)}>{t('來源記錄', 'Source record')}</button></td></tr>)}</tbody></table></div> : !data && loading ? <p role="status">{t('額度快照讀取中…', 'Loading quota snapshots…')}</p> : data ? <p className="inspector-empty">{t('未有可用嘅被動額度資料。新記錄或「重新解析」成功後可補入；核心用量統計仍可使用。', 'No supported passive quota data is indexed. New records or a successful reparse can supply it; usage analysis remains available.')}</p> : null}
    <p className="inspector-footnote">{t('呢度顯示記錄內嘅被動額度快照。官方帳戶累計可喺「用量總覽」另外讀取；百分比唔會推算成 Token 上限，亦唔會讀取登入檔案或餘額。', 'These are passive quota snapshots. Read official account lifetime usage separately in Overview. Percentages do not imply token allowances; authentication files and credit balances are not read.')}</p>
  </section>;
}
