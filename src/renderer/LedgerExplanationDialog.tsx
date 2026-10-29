import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { InspectorBridge, LedgerEntry, LedgerExplanation } from '../shared/inspector';
import './LedgerExplanationDialog.css';

const count = (value: string | null) => value === null ? '—' : BigInt(value).toLocaleString('en-US');
export function LedgerExplanationDialog({ api, entry, language, onClose, onEvidence, onTimeline }: { api: InspectorBridge; entry: LedgerEntry; language: 'zh' | 'en'; onClose: () => void; onEvidence: (id: string) => void; onTimeline: (id: string) => void }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [data, setData] = useState<LedgerExplanation>(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null); const request = useRef(0); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      const first = buttons[0]; const last = buttons.at(-1);
      if (!dialog.current?.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', keyboard);
    const privacy = window.agentMonitor?.onPrivacyChanged?.(() => { request.current++; setData(undefined); close.current(); });
    return () => { request.current++; privacy?.(); window.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const id = ++request.current; setData(undefined); setError(''); setBusy(true);
    void api.explainLedger({ id: entry.id, revision: entry.revision }).then(result => { if (id === request.current) setData(result); }).catch(e => { if (id === request.current) setError((e as Error).message); }).finally(() => { if (id === request.current) setBusy(false); });
    return () => { request.current++; };
  }, [api, entry.id, entry.revision]);
  const next = async () => {
    if (!data?.nextCursor || busy) return; const id = ++request.current; setBusy(true); setError('');
    try { const result = await api.explainLedger({ id: entry.id, revision: entry.revision, cursor: data.nextCursor }); if (id === request.current) setData(previous => previous ? { ...result, observations: [...previous.observations, ...result.observations] } : result); }
    catch (e) { if (id === request.current) { setError((e as Error).message); if (/INVALIDATED|UNAVAILABLE/.test((e as Error).message)) setData(undefined); } }
    finally { if (id === request.current) setBusy(false); }
  };
  return <div className="inspector-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="inspector-dialog ledger-explanation-dialog" role="dialog" aria-modal="true" aria-label={t('解釋呢筆用量', 'Explain this usage entry')}>
      <header><div><h2>{t('解釋呢筆用量', 'Explain this usage entry')}</h2><small>{entry.id} · {t('帳本快照', 'Ledger snapshot')} {entry.revision}</small></div><button className="inspector-icon-button" aria-label={t('關閉帳本解釋', 'Close ledger explanation')} onClick={onClose}><X size={20} /></button></header>
      {error && <p role="alert">{error} · {t('如來源或版本已改變，關閉再更新帳本。', 'If sources or versions changed, close and refresh the ledger.')}</p>}
      {busy && <p role="status">{t('讀取保留嘅帳本證據…', 'Reading retained ledger support…')}</p>}
      {data && <>
        <div className="ledger-explanation-summary"><div><span>{t('計入狀態', 'Selection')}</span><strong>{data.entry.selectionStatus === 'selected' ? t('已計入', 'Included') : t('已隔離，唔計入總數', 'Quarantined, excluded from totals')}</strong></div><div><span>{t('成員類型', 'Entry grain')}</span><strong>{data.entry.grain}</strong></div><div><span>{t('呢筆 Total', 'Entry total')}</span><strong>{count(data.entry.usage.total.value)}</strong></div><div><span>{t('關聯來源紀錄', 'Linked records')}</span><strong>{data.observationCount}</strong></div></div>
        <p>{data.entry.grain === 'response' ? t('相同身份嘅回應來源支持同一筆成員，唔會按來源份數再加一次。', 'Records of the same identified response support one entry, counted once.') : data.entry.grain === 'interval' ? t('呢筆係同源 counter 區間差額；可核對嘅有身份回應已排除，唔係新造嘅模型 request。', 'This is a same-source counter interval remainder, excluding supported identified responses; it is not an invented model request.') : t('呢筆係先前累積用量，沒有將匯入時間當成實際執行時間。', 'This is prior cumulative usage; import time is not its execution time.')}</p>
        <dl className="ledger-explanation-identity"><dt>{t('模型／路線', 'Model / route')}</dt><dd>{data.entry.model.observedModel ?? data.entry.model.requestedModel ?? '—'} · {data.entry.model.provenance} · {data.entry.model.providerRoute ?? '—'}</dd><dt>{t('Thread／回應身份', 'Thread / response identity')}</dt><dd>{data.entry.identity.threadId ?? '—'} / {data.entry.identity.responseId ?? '—'}</dd><dt>{t('計算規則／序列基準', 'Policy / sequence basis')}</dt><dd>{data.entry.policyVersion} · {data.entry.coverage.sequenceBasis ?? 'unknown'} · {data.entry.coverage.fromSequence ?? '—'} → {data.entry.coverage.toSequence ?? '—'}</dd><dt>{t('同一 Scope 現行版本', 'Current scope revision')}</dt><dd>{data.activeRevision}{data.activeRevision !== data.entry.revision && t('；呢個解釋保留點選時嘅帳本版本。', '; this explanation preserves the clicked entry revision.')}</dd></dl>
        {data.entry.issues.map(issue => <p className="inspector-footnote" key={issue}>{issue}</p>)}
        {[...new Set(Object.values(data.entry.usage).flatMap(metric => metric.assumptions))].map(note => <p className="inspector-footnote" key={note}>{note}</p>)}
        <h3>{t('來源證據', 'Supporting observations')}</h3><p className="inspector-footnote">{data.supportCount} support · {data.controlCount} control · {data.observations.length} / {data.observationCount} {t('已顯示。記錄設備未必係原始執行設備；相同數值唔足以證明複製或重置。', 'shown. Recording machine may differ from execution origin; equal values do not prove copying or reset.')}</p>
        <div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>{t('來源／位置', 'Source / position')}</th><th>{t('角色／觀察數字', 'Relation / observed values')}</th><th>{t('證據導航', 'Evidence navigation')}</th></tr></thead><tbody>{data.observations.map(row => <tr key={`${row.id}:${row.relation}`}><td><strong>{row.kind}</strong><small>{row.sourceId}</small><small>{t('記錄設備', 'Recording machine')} · {row.recordingMachineId}</small><small>gen {row.generation} · line {row.line} · bytes {row.byteStart}–{row.byteEnd}</small><small>{row.timestamp ?? t('來源時間未知', 'Source time unknown')}</small></td><td><span className="inspector-badge">{row.relation}</span>{row.measurements.map((measurement, index) => <div key={index}><small>{measurement.kind} · {measurement.responseId ?? '—'}</small><small>Input {count(measurement.values.input)} · Output {count(measurement.values.output)} · Total {count(measurement.values.total)} · {t('原生 Total', 'Native total')} {count(measurement.nativeTotal)}</small>{measurement.issues.map(issue => <small key={issue}>{issue}</small>)}</div>)}{row.issues.map(issue => <small key={issue}>{issue}</small>)}</td><td><button className="inspector-link" onClick={() => onTimeline(row.evidenceRef)}>Timeline</button><button className="inspector-link" onClick={() => onEvidence(row.evidenceRef)}>{t('原始來源預覽', 'Source preview')}</button></td></tr>)}</tbody></table></div>
        {data.nextCursor && <button className="inspector-action-button" disabled={busy} onClick={() => void next()}>{t('載入更多來源（每批 50）', 'Load more observations (50 per batch)')}</button>}
        <h3>{t('截至呢個快照嘅保留版本', 'Retained history through this snapshot')}</h3><p className="inspector-footnote">{data.history.length} / {data.historyCount} {t('版本，最多顯示最近 20 個。同一身份唔同觀察若有矛盾會隔離；呢度唔會將下跌當成已確認重置或負數 request。', 'versions, latest 20 shown. Contradictory observations are quarantined; a decrease is not treated as a confirmed reset or negative request.')}</p>
        <div className="ledger-explanation-history">{data.history.map(item => <div key={item.revision}><strong>rev {item.revision}</strong><span>{item.selectionStatus} · Total {count(item.total)} · {item.evidenceCount} {t('來源', 'records')}</span><small>{item.policyVersion} · {item.createdAt}</small>{item.issues.map(issue => <small key={issue}>{issue}</small>)}</div>)}</div>
        <p className="inspector-footnote">{t('來源觀察數字係核對證據，唔可以逐行相加。呢個入口只讀 Metadata；原始預覽沿用 Project 私隱限制。', 'Source figures are reconciliation evidence and must not be summed per row. This entry point reads metadata only; source preview uses project privacy controls.')}</p>
      </>}
    </section>
  </div>;
}
