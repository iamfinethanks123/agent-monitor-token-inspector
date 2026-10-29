import { useState } from 'react';
import type { BudgetMetric, BudgetPolicy, BudgetState, InspectorBridge, InspectorQuery } from '../shared/inspector';

export function budgetAmount(value: string | null | undefined, policy: BudgetPolicy): string {
  if (value == null) return '—';
  if (policy.metric === 'api_estimate') return `${policy.currency} ${value}`;
  if (policy.metric === 'elapsed_ms') return `${(BigInt(value) / 1000n).toLocaleString()} s`;
  return `${BigInt(value).toLocaleString()} tokens`;
}

export function BudgetsPanel({ api, query, data, language, reload }: { api: InspectorBridge; query: InspectorQuery; data?: BudgetState; language: 'zh' | 'en'; reload: () => Promise<void> }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [metric, setMetric] = useState<BudgetMetric>('tokens'); const [limit, setLimit] = useState(''); const [currency, setCurrency] = useState('USD'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const valid = metric === 'api_estimate' ? /^(0|[1-9]\d*)(\.\d{1,12})?$/.test(limit) && /[1-9]/.test(limit) && /^[A-Z]{3}$/.test(currency) : /^[1-9]\d*$/.test(limit);
  const labels: Record<BudgetMetric, string> = { tokens: t('已觀察 Token', 'Observed tokens'), uncached_input: t('未快取 Input', 'Uncached input'), elapsed_ms: t('已記錄時間跨度', 'Recorded time span'), api_estimate: t('API 等值估算', 'API-equivalent estimate') };
  const save = async () => {
    setBusy(true); setError('');
    try { await api.setBudget({ query, metric, tokenLimit: metric === 'elapsed_ms' ? (BigInt(limit) * 60000n).toString() : limit, ...(metric === 'api_estimate' ? { currency } : {}) }); setLimit(''); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('用量及資源預算', 'Usage and resource budgets')}</h2><p>{t('保存目前 Run／Project 範圍；不同單位分開追蹤，達到門檻只提醒。', 'Save the current run/project scope; units are tracked separately and thresholds are advisory.')}</p></div></div>
    <div className="inspector-form-grid"><label>{t('追蹤項目', 'Metric')}<select aria-label="Budget metric" value={metric} onChange={e => { setMetric(e.target.value as BudgetMetric); setLimit(''); }}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>{metric === 'elapsed_ms' ? t('門檻（分鐘）', 'Threshold (minutes)') : t('門檻', 'Threshold')}<input aria-label="Resource budget threshold" inputMode={metric === 'api_estimate' ? 'decimal' : 'numeric'} value={limit} onChange={e => setLimit(e.target.value)} /></label>
      {metric === 'api_estimate' && <label>{t('貨幣（只追蹤呢一種）', 'Currency (tracked separately)')}<input aria-label="Budget currency" value={currency} maxLength={3} onChange={e => setCurrency(e.target.value.toUpperCase())} /></label>}</div>
    <p className="inspector-footnote">{metric === 'elapsed_ms' ? t('時間按首尾已記錄用量計算，唔係實際執行時長；多設備時鐘不可直接比較。', 'Time is the span between recorded usage timestamps, not actual runtime; cross-machine clocks are not comparable.') : metric === 'api_estimate' ? t('只用已覆核價目嘅已知小計；未能定價部分列明，唔係訂閱收費。', 'Uses known subtotals from reviewed rate cards; missing coverage stays visible and this is not subscription billing.') : metric === 'uncached_input' ? t('缺少 Input 或 Cache 欄位時保留未知，唔會假設全部未快取。', 'Missing input/cache fields remain unknown; no all-uncached assumption is made.') : t('只用核對帳本，唔會加入工具文字估算。', 'Uses the reconciled ledger without adding tool-text estimates.')}</p>
    {error && <p role="alert" className="inspector-form-error">{error}</p>}<button className="inspector-action-button" disabled={!valid || busy} onClick={() => void save()}>{t('保存預算', 'Save budget')}</button>
    {data?.policies.map(policy => <article className="inspector-finding" key={policy.id}><header><h3>{labels[policy.metric ?? 'tokens']}</h3><span className="inspector-badge">{policy.crossed ? t('已提醒', 'Alerted') : policy.historical ? t('歷史／保存時已達門檻', 'Historical / already above threshold') : policy.current === null ? t('資料不足', 'Insufficient data') : t('觀察中', 'Monitoring')}</span></header><p>{budgetAmount(policy.current, policy)} / {budgetAmount(policy.tokenLimit, policy)}</p><p className="inspector-footnote">{policy.query.runId ?? policy.query.agentId ?? policy.query.projectId ?? t('全部已選範圍', 'Selected aggregate scope')}{policy.query.machineId ? ` · ${policy.query.machineId}` : ''}</p>{policy.issues.length > 0 && <p className="inspector-footnote">{policy.issues.join(' · ')}</p>}
      <button className="inspector-link" onClick={async () => { try { await api.removeBudget(policy.id); await reload(); } catch (e) { setError((e as Error).message); } }}>{t('移除預算', 'Remove budget')}</button></article>)}
  </section>;
}
