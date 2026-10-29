import { useEffect, useRef, useState } from 'react';
import { FileSearch, X } from 'lucide-react';
import type { InspectorBridge, SampleCapability, SourceSampleReport } from '../shared/inspector';

export function SourceSamplePanel({ api, language }: { api: InspectorBridge; language: 'zh' | 'en' }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [report, setReport] = useState<SourceSampleReport>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const request = useRef(0);
  useEffect(() => { const unsubscribe = window.agentMonitor?.onPrivacyChanged?.(() => { request.current++; setReport(undefined); setBusy(false); }); return () => { request.current++; unsubscribe?.(); }; }, []);
  const inspect = async () => {
    const epoch = ++request.current; setBusy(true); setError('');
    try { const result = await api.inspectSourceSample(); if (epoch === request.current && !result.cancelled) setReport(result.report); }
    catch (e) { if (epoch === request.current) setError((e as Error).message); }
    finally { if (epoch === request.current) setBusy(false); }
  };
  const labels: Record<SampleCapability, string> = {
    usage_snapshots: t('用量觀察', 'Usage observations'), response_identity: t('逐回應身份', 'Response identity'), input: 'Input', output: 'Output', cached_input: 'Cached input', cache_write_input: 'Cache write input', reasoning_output: 'Reasoning output',
    tool_pairing: t('工具呼叫／結果配對', 'Tool call / result pairing'), parent_links: t('Parent Agent 連結', 'Parent-agent links'), compaction: t('Context 壓縮記錄', 'Compaction metadata'), model_identity: t('模型歸屬資料', 'Model attribution metadata'), source_timestamps: t('來源時間', 'Source timestamps'), context_manifests: t('Instrumented Context manifest', 'Instrumented context manifest'),
  };
  const states = { ready: t('可用：已觀察到有身份嘅有效 Input／Output 回應', 'Ready: valid identified input/output response observed'), partial: t('部分能力／樣本有限', 'Partial capability / bounded sample'), unsupported: t('呢個樣本未識別到支援記錄', 'No supported record recognized in this sample'), permission_denied: t('沒有讀取權限', 'Read permission denied'), unavailable: t('來源暫時無法檢查', 'Source unavailable') };
  const capabilityStates = { observed: t('已觀察', 'Observed'), partial: t('未完整配對', 'Unpaired / ambiguous'), not_observed: t('樣本未觀察到', 'Not observed in sample'), invalid: t('欄位有記錄但未能採用', 'Present but not usable'), unsupported: t('呢個 Adapter 未支援', 'Unsupported by this adapter') };
  return <section className="inspector-panel" aria-label="Local source sample inspection"><div className="inspector-panel-heading"><div><h2>{t('本機來源樣本檢查', 'Inspect a source sample locally')}</h2><p>{t('揀一份 Codex .jsonl，核對可用欄位同格式。只檢查首 4 MiB／最多 512 行，每行上限 2 MiB；唔會加入來源目錄、帳本或同步資料。', 'Choose a Codex .jsonl to inspect its fields and format. First 4 MiB / 512 lines, up to 2 MiB per line; no source enrollment, ledger import or synchronization.')}</p></div><span className="inspector-badge">local only</span></div>
    <button className="inspector-action-button" disabled={busy} onClick={() => void inspect()}><FileSearch size={15} />{t('揀檔案並檢查樣本', 'Choose & inspect sample')}</button>
    {busy && <p role="status">{t('讀取樣本 Metadata…', 'Inspecting sample metadata…')}</p>}{error && <p role="alert">{error}</p>}
    {report && <div><div className="inspector-panel-heading"><div><h3>{states[report.state]}</h3><p>{report.adapterVersion} · {report.inspectedAt} · {t('檢查主機', 'Inspection host')} {report.inspectionHost.os === 'darwin' ? 'macOS' : report.inspectionHost.os === 'win32' ? 'Windows' : report.inspectionHost.os} / {report.inspectionHost.architecture}</p></div><button className="inspector-link" aria-label={t('清除樣本結果', 'Clear sample result')} onClick={() => { request.current++; setReport(undefined); setBusy(false); setError(''); }}><X size={14} /></button></div>
      <p>{t('已檢查', 'Inspected')} {report.sampledBytes.toLocaleString()} / {report.fileBytes === null ? '—' : BigInt(report.fileBytes).toLocaleString()} bytes · {report.records} {t('完整行', 'complete lines')} · {report.parsedRecords} {t('已解析', 'parsed')} · {report.invalidRecords} {t('格式／語義問題行', 'syntax/semantic issue lines')} · {report.unsupportedRecords} {t('未支援行', 'unsupported lines')} · {report.oversizedRecords} {t('超大行已跳過', 'oversized lines skipped')}</p>
      <p>{t('來源記錄嘅 Runtime：', 'Runtime recorded in source: ')}{report.runtimeUnknown ? t('未知', 'Unknown') : report.runtimeVersions.join(' · ')}</p>
      <div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>{t('能力／欄位', 'Capability / field')}</th><th>{t('觀察數', 'Observed count')}</th><th>{t('可用數', 'Usable count')}</th><th>{t('狀態', 'State')}</th></tr></thead><tbody>{report.capabilities.map(item => <tr key={item.id}><td>{labels[item.id]}</td><td>{item.presentRecords}</td><td>{item.usableRecords}</td><td>{capabilityStates[item.state]}</td></tr>)}</tbody></table></div>
      <p className="inspector-footnote">{t('數字係有相關欄位嘅樣本行數，唔係 Token 總數；配對可用數係同一 Thread 下唯一呼叫／結果 ID 配對數。缺少配對唔等於工具失敗。檢查主機唔代表來源執行設備。', 'Counts describe sample records, not token totals; usable tool pairs require unique call/result IDs within one thread. Missing pairs do not prove tool failure. Inspection host is not execution origin.')}</p>
      {(report.limited || report.pendingTailBytes > 0 || report.changedDuringRead) && <p className="inspector-footnote">{t('結果只涵蓋已檢查範圍；未觀察到唔代表整份來源冇呢個欄位。', 'Results cover the examined prefix only; absence here does not establish absence in the whole source.')} {report.pendingTailBytes} {t('尾段 bytes 未解析', 'tail bytes unparsed')} · {report.changedDuringRead ? t('讀取期間來源有變動', 'Source changed while reading') : ''}</p>}
      {report.reasons.map(reason => <small key={reason} className="inspector-footnote">{reason === 'UNSUPPORTED_USAGE_FIELDS' ? t('已提供用量資料，但欄位格式未支援；唔會猜 Token 數或當成零。', 'Usage was supplied in an unsupported field format; token counts are not guessed or treated as zero.') : reason === 'UNSUPPORTED_TOOL_OUTPUT_PARTS' || reason === 'UNSUPPORTED_TOOL_OUTPUT_FORMAT' ? t('工具輸出有未支援格式；只量度可識別文字，其他分段保留為未知。', 'Tool output contains unsupported formats; only recognized text is measured, other parts remain unknown.') : reason}<br /></small>)}
      <details><summary>{t('格式 Fingerprint', 'Schema fingerprints')} · {report.schemaFingerprints.length} / {report.schemaCount}</summary><p className="inspector-footnote">{t('最多列出 32 種；只識別格式，唔包含欄位值、來源路徑或內容。', 'Up to 32 schemas; fingerprints describe layout and do not include field values, paths or content.')}</p>{report.schemaFingerprints.map(schema => <p className="inspector-footnote" key={schema.fingerprint}>{schema.fingerprint} · {schema.records} {t('行', 'records')}</p>)}</details>
    </div>}
  </section>;
}
