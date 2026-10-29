import { useState } from 'react';
import type { AccountUsageView, InspectorBridge, InspectorSummary } from '../shared/inspector';

function tokens(value: string | null | undefined, language: 'zh' | 'en'): string {
  if (value == null) return '—';
  const count = BigInt(value);
  return language === 'zh' && count >= 100000000n
    ? `${count / 100000000n}.${((count % 100000000n) / 1000000n).toString().padStart(2, '0')} 億`
    : count.toLocaleString('en-US');
}

export function AccountUsagePanel({ api, summary, language }: { api: InspectorBridge; summary?: InspectorSummary; language: 'zh' | 'en' }) {
  const [data, setData] = useState<AccountUsageView>(); const [busy, setBusy] = useState(false); const [error, setError] = useState<AccountUsageView['error']>(null);
  const [days, setDays] = useState(30);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const buckets = [...(data?.dailyUsageBuckets ?? [])].sort((left, right) => left.startDate.localeCompare(right.startDate));
  const lastDate = buckets.at(-1)?.startDate;
  const cutoff = lastDate && days ? new Date(Date.parse(`${lastDate}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10) : '';
  const visible = buckets.filter(bucket => bucket.startDate >= cutoff).slice(-366);
  const firstDay = visible.length ? Date.parse(`${visible[0].startDate}T00:00:00Z`) : 0;
  const spanDays = visible.length ? (Date.parse(`${visible.at(-1)!.startDate}T00:00:00Z`) - firstDay) / 86400000 + 1 : 1;
  const maximum = visible.reduce((max, bucket) => BigInt(bucket.tokens) > max ? BigInt(bucket.tokens) : max, 1n);
  const subtotal = visible.reduce((sum, bucket) => sum + BigInt(bucket.tokens), 0n).toString();
  const load = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { const next = await api.accountUsage(); if (next.state === 'available') setData(next); else setError(next.error ?? 'USAGE_UNAVAILABLE'); }
    catch { setError('CONNECTION_CLOSED'); }
    finally { setBusy(false); }
  };
  return <section className="inspector-panel inspector-account-usage" aria-label="Account and collected usage">
    <div className="inspector-panel-heading"><div><h2>{t('帳戶累計與已收集明細', 'Account lifetime and collected records')}</h2><p>{t('官方累計以帳戶為範圍；設備、模型及成本圖表以已收集明細為範圍。', 'Official lifetime usage covers the account; device, model and cost charts use collected records.')}</p></div><button className="inspector-link" onClick={() => void load()} disabled={busy}>{busy ? t('讀取中…', 'Reading…') : data ? t('更新官方累計', 'Refresh official total') : t('讀取官方帳戶累計', 'Read official account total')}</button></div>
    <div className="inspector-account-values">
      <div><span>{t('官方帳戶累計 · 全部時間', 'Official account lifetime · all time')}</span><strong aria-label="Official lifetime tokens" title={data?.lifetimeTokens ?? undefined}>{tokens(data?.lifetimeTokens, language)} <small>tokens</small></strong><small>{data ? `${data.accountLabel ?? t('本機 Codex 登入帳戶', 'Local Codex account')} · ${t('讀取於', 'Read at')} ${new Date(data.measuredAt!).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB')}` : t('按上面按鈕，透過本機已登入嘅 Codex 讀取官方數字。', 'Use the button to read the official total through your signed-in local Codex.')}</small></div>
      <div><span>{t('已收集明細 · 目前篩選範圍', 'Collected records · current filters')}</span><strong aria-label="Collected ledger tokens" title={summary?.usage.total.value ?? undefined}>{tokens(summary?.usage.total.value, language)} <small>tokens</small></strong><small>{summary ? `${summary.selectedEntries.toLocaleString()} ${t('筆已核對用量', 'reconciled entries')} · ${summary.quarantinedEntries.toLocaleString()} ${t('筆衝突記錄未納入', 'conflicted entries excluded')}` : t('讀取中…', 'Loading…')}</small></div>
    </div>
    {error && <p role="alert">{error === 'UNSUPPORTED_ACCOUNT' ? t('目前 Codex 登入方式唔支援帳戶累計，例如只用 API Key。請喺 Codex 使用受支援嘅 ChatGPT 帳戶登入後重試。', 'This Codex authentication mode, such as API-key-only, does not provide account lifetime usage. Sign in with a supported ChatGPT account in Codex and retry.') : error === 'CLI_UNAVAILABLE' ? t('未能啟動本機 Codex CLI。請先安裝或開啟 ChatGPT／Codex，再重試。', 'The local Codex CLI could not start. Install or open ChatGPT/Codex, then retry.') : t('暫時未能讀取官方累計。請確認本機 Codex 已登入 ChatGPT 帳戶同可以連線，再重試。', 'Official usage is unavailable. Check your local Codex ChatGPT sign-in and connection, then retry.')} {data && t('先前成功讀取嘅數字保留原有時間。', 'The previous successful reading keeps its original timestamp.')}</p>}
    {data && <details className="inspector-account-history"><summary>{t('官方每日活動與單日峰值', 'Official daily activity and peak usage')}</summary>
      <div className="inspector-account-chart-controls"><label>{t('官方日期範圍', 'Official date range')}<select aria-label="Official activity date range" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>{t('最近 7 日', 'Last 7 days')}</option><option value={30}>{t('最近 30 日', 'Last 30 days')}</option><option value={0}>{t('已回傳歷史（最多 366 筆）', 'Returned history (up to 366 dates)')}</option></select></label><span>{t('官方全部時間單日峰值：', 'Official all-time daily peak: ')}<strong aria-label="Official peak daily tokens">{tokens(data.peakDailyTokens, language)}</strong></span><span>{t('所選日期已知小計：', 'Selected dates known subtotal: ')}<strong aria-label="Official selected dates tokens">{visible.length ? tokens(subtotal, language) : '—'}</strong></span></div>
      {visible.length ? <><figure className="inspector-chart"><svg viewBox="0 0 800 200" role="img" aria-label={t('官方每日 Token 活動', 'Official daily token activity')}>
        {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="92" x2="790" y1={164 - 140 * fraction} y2={164 - 140 * fraction} className="chart-grid" /><text x="83" y={168 - 140 * fraction} textAnchor="end" className="chart-label">{tokens((maximum * BigInt(Math.round(fraction * 100)) / 100n).toString(), language)}</text></g>)}
        {visible.map((bucket, index) => { const slot = 698 / spanDays; const height = Number(BigInt(bucket.tokens) * 10000n / maximum) / 10000 * 140; const x = 92 + slot * ((Date.parse(`${bucket.startDate}T00:00:00Z`) - firstDay) / 86400000); return <g key={bucket.startDate}><title>{`${bucket.startDate}: ${BigInt(bucket.tokens).toLocaleString('en-US')} tokens`}</title><rect x={x + Math.min(2, slot / 5)} y={164 - height} width={Math.max(0.5, slot * 0.7)} height={height} rx="1" className="chart-response" />{(index === 0 || index === visible.length - 1 || index % Math.max(1, Math.ceil(visible.length / 8)) === 0) && <text x={x + slot / 2} y="189" textAnchor="middle" className="chart-label">{bucket.startDate.slice(5)}</text>}</g>; })}
      </svg><figcaption>{visible[0].startDate} → {visible.at(-1)!.startDate} · {visible.length} {t('個官方日期；缺少嘅日期未當成零。', 'reported dates; missing dates are not treated as zero.')}</figcaption></figure>
      <details><summary>{t('查看每日精確數字', 'Show exact daily values')}</summary><div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>{t('官方日期', 'Official date')}</th><th>Tokens</th></tr></thead><tbody>{visible.map(bucket => <tr key={bucket.startDate}><td>{bucket.startDate}</td><td>{BigInt(bucket.tokens).toLocaleString('en-US')}</td></tr>)}</tbody></table></div></details></> : <p className="inspector-empty">{t('官方未提供可顯示嘅每日記錄；帳戶累計如有回傳仍會保留。', 'No official daily records are available; any reported lifetime total is retained.')}</p>}
      <p className="inspector-footnote">{t('日期標籤沿用官方回覆；回覆未標明時區，因此唔會同本機香港時間圖表自動合併。日期範圍以最新官方日期為終點，唔影響上面嘅全部時間累計或設備篩選。', 'Dates follow the service response, which does not identify a time zone, so this chart is not merged with the local Hong Kong time charts. Date ranges end at the latest official date and do not change lifetime usage or device filters.')}</p>
    </details>}
    <p className="inspector-footnote">{t('兩個數字唔會相加。官方累計唔受上面嘅日期／設備篩選影響；帳本未逐筆核實帳戶歸屬，兩邊差距暫時唔會自動分配到某台設備、模型或美元成本。Monitor 只要求讀取統計，唔會建立任務或複製登入檔案；登入驗證由 Codex 處理。', 'These totals are not added. Date/device filters do not change account lifetime usage. Ledger account ownership is not verified entry by entry, so differences are not assigned to devices, models or USD costs. Monitor requests statistics without creating a task or copying authentication files; Codex handles authentication.')}</p>
  </section>;
}
