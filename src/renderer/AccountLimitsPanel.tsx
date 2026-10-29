import { useRef, useState } from 'react';
import type { AccountLimitWindow, AccountRateLimitsView, InspectorBridge } from '../shared/inspector';

export function AccountLimitsPanel({ api, language }: { api: InspectorBridge; language: 'zh' | 'en' }) {
  const [data, setData] = useState<AccountRateLimitsView>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<AccountRateLimitsView['error']>(null);
  const reading = useRef(false);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const date = (seconds: number) => new Date(seconds * 1000).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB', { timeZone: 'Asia/Hong_Kong' });
  const duration = (minutes: number | null) => minutes === null ? t('時長未知', 'Duration unknown') : minutes > 0 && minutes % 1440 === 0 ? `${minutes / 1440} ${t('日', 'days')}` : minutes > 0 && minutes % 60 === 0 ? `${minutes / 60} ${t('小時', 'hours')}` : `${minutes} ${t('分鐘', 'minutes')}`;
  const load = async () => {
    if (reading.current) return;
    reading.current = true; setBusy(true); setError(null);
    try { const next = await api.accountRateLimits(); if (next.state === 'available') setData(next); else setError(next.error ?? 'USAGE_UNAVAILABLE'); }
    catch { setError('CONNECTION_CLOSED'); }
    finally { reading.current = false; setBusy(false); }
  };
  const window = (value: AccountLimitWindow | null, label: string) => <div className="inspector-account-window">
    <span>{label} · {value ? duration(value.windowDurationMins) : t('未提供', 'Not supplied')}</span>
    {value ? <><strong>{Math.max(0, Math.min(100, 100 - value.usedPercent)).toLocaleString(language === 'zh' ? 'zh-HK' : 'en-GB', { maximumFractionDigits: 2 })}% <small>{t('剩餘', 'remaining')}</small></strong><progress max={100} value={Math.min(100, value.usedPercent)} aria-label={`${label} ${t('已使用百分比', 'used percent')}`} /><small>{t('已使用', 'Used')} {value.usedPercent}% · {value.resetsAt === null ? t('重設時間未知', 'Reset time unknown') : `${t('重設於', 'Resets at')} ${date(value.resetsAt)} HKT`}</small></> : <strong>—</strong>}
  </div>;
  return <section className="inspector-panel inspector-account-limits" aria-label="Official account rate limits">
    <div className="inspector-panel-heading"><div><h2>{t('目前帳戶額度', 'Current account limits')}</h2><p>{t('透過本機 Codex 查詢；按帳戶計算，唔受日期、設備或模型篩選影響。', 'Read through local Codex for the account, independently of date, device and model filters.')}</p></div><button className="inspector-link" onClick={() => void load()} disabled={busy}>{busy ? t('查詢中…', 'Reading…') : data ? t('更新目前額度', 'Refresh current limits') : t('查詢目前額度', 'Read current limits')}</button></div>
    {!data && !busy && !error && <p className="inspector-empty">{t('按「查詢目前額度」讀取官方快照。未查詢嘅欄位保持未知。', 'Read an official snapshot with the button. Unread fields remain unknown.')}</p>}
    {busy && <p role="status">{t('正向 Codex 讀取帳戶額度…', 'Reading account limits from Codex…')}</p>}
    {error && <p role="alert">{error === 'SIGN_IN_REQUIRED' || error === 'UNSUPPORTED_ACCOUNT' ? t('本機 Codex 未登入受支援嘅 ChatGPT 帳戶；請喺 Codex 處理登入後重試。', 'Local Codex needs a supported ChatGPT sign-in; sign in there and retry.') : error === 'CLI_UNAVAILABLE' ? t('未能啟動本機 Codex，請確認已安裝。', 'The local Codex CLI could not start; check its installation.') : t('暫時未能讀取目前額度，請稍後重試。', 'Current limits are unavailable; try again later.')} {data && t('上次成功快照同原有時間仍保留。', 'The previous successful snapshot and its timestamp are retained.')}</p>}
    {data && <><p className="inspector-footnote">{data.accountLabel ?? t('本機 Codex 登入帳戶', 'Local Codex account')} · {t('讀取於', 'Read at')} {date(Date.parse(data.measuredAt!) / 1000)} HKT</p>
      <div className="inspector-account-limit-buckets">{data.buckets.map(bucket => <article className="inspector-account-limit-bucket" key={bucket.id}>
        <h3>{bucket.name || bucket.id}</h3><div className="inspector-account-values">{window(bucket.primary, t('主要時段', 'Primary window'))}{window(bucket.secondary, t('次要時段', 'Secondary window'))}</div>
        {bucket.credits && <p className="inspector-footnote">{t('工作區 Credits：', 'Workspace credits: ')}{bucket.credits.unlimited ? t('官方標示無上限', 'Reported as unlimited') : bucket.credits.balance ?? (bucket.credits.hasCredits ? t('有可用 Credits，餘額未提供', 'Credits available; balance not supplied') : t('官方回覆無可用 Credits', 'No credits reported'))} · {t('單位沿用官方回覆，唔轉成美元或 Token。', 'Units follow the service response and are not converted to USD or tokens.')}</p>}
      </article>)}</div>
      {!data.buckets.length && <p className="inspector-empty">{t('官方未提供額度視窗。', 'No quota windows were supplied.')}</p>}
      <p className="inspector-footnote">{t('一般包含用量：', 'Ordinary included usage: ')}{data.ordinaryUsageAllowed === null ? t('未提供可用狀態', 'Availability not supplied') : data.ordinaryUsageAllowed ? t('官方允許', 'Allowed by service') : t('官方暫不允許', 'Currently disallowed by service')} · {t('可用重設次數：', 'Available resets: ')}{data.availableResetCredits ?? '—'}</p>
    </>}
    <p className="inspector-footnote">{t('百分比唔等於剩餘 Token 或美元；到達重設時間亦唔代表已恢復使用。呢度只顯示快照，唔會啟動額度時段、使用重設次數或發送電郵；舊記錄視窗仍喺「數據品質 → 額度記錄」。', 'Percentages are not token or USD balances; reaching a reset time does not establish recovered access. This snapshot does not start usage windows, consume resets or send emails. Historical windows remain under Data quality → Recorded quotas.')}</p>
  </section>;
}
