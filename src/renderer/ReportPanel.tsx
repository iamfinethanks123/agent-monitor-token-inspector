import { useEffect, useRef, useState } from 'react';
import type { InspectorBridge, InspectorQuery, PairedSelection, ReportOptions, TaskContract } from '../shared/inspector';

export function ReportPanel({ api, query, language, initialContractId, pairedSelection, diagnosticOnly = false, diagnosticTable = 'data-quality' }: { api: InspectorBridge; query: InspectorQuery; language: 'zh' | 'en'; initialContractId?: string; pairedSelection?: PairedSelection; diagnosticOnly?: boolean; diagnosticTable?: 'data-quality' | 'tool-activity' | 'detector-evaluation' }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [contracts, setContracts] = useState<TaskContract[]>([]); const [contractId, setContractId] = useState('');
  const [format, setFormat] = useState<'markdown' | 'json' | 'csv'>('markdown'); const [table, setTable] = useState<NonNullable<ReportOptions['table']>>(diagnosticOnly ? diagnosticTable : 'ledger'); const [includeNotes, setIncludeNotes] = useState(false);
  const [preview, setPreview] = useState<{ body: string; revision: number; previewId: string } | null>(null); const [page, setPage] = useState(0); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [privacyEpoch,setPrivacyEpoch] = useState(0);
  useEffect(() => window.agentMonitor?.onPrivacyChanged?.(() => { current.current = ''; setPreview(null); setPrivacyEpoch(value => value + 1); }), []);
  const selection = JSON.stringify([privacyEpoch, query, contractId, format, table, includeNotes, pairedSelection, initialContractId]); const current = useRef(selection); current.current = selection;
  useEffect(() => { let alive = true; if (diagnosticOnly || pairedSelection) return; void api.experiments().then(result => { if (alive) setContracts(result.contracts); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [api, diagnosticOnly, !!pairedSelection]);
  useEffect(() => { if (initialContractId) { setContractId(initialContractId); setTable('trials'); } }, [initialContractId]);
  useEffect(() => { setPreview(null); setPage(0); }, [selection]);
  const prepare = async () => {
    const requested = selection; setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.report(query, format, { contractId: pairedSelection ? initialContractId : contractId || undefined, table: pairedSelection ? 'paired-trials' : table, includeTaskNotes: includeNotes, ...(pairedSelection ? { pairedComparison: pairedSelection } : {}) });
      if (current.current === requested) { setPreview(result); setPage(0); }
    } catch (e) { if (current.current === requested) { const message = (e as Error).message; setError(message.includes('PROJECT_EXPORT_RESTRICTED') ? t('呢個範圍包含禁止匯出嘅 Project。請先調整範圍或 Project 匯出設定；混合 Session 亦可能受限制。', 'This scope contains an export-restricted project. Change the scope or project policy; mixed sessions may also be restricted.') : message.includes('REPORT_TOO_LARGE') || message.includes('REPORT_POPULATION_LIMIT') ? t('報告超出完整匯出上限。請縮窄日期、設備或 Run 範圍，再建立預覽。', 'The complete report exceeds the export limit. Narrow the date, machine or run scope and prepare another preview.') : message); } } finally { setBusy(false); }
  };
  const save = async () => {
    if (!preview) return; setBusy(true); setError('');
    try { const result = await api.exportReport(preview.previewId); if (result.saved) { setNotice(`${t('已保存：', 'Saved: ')}${result.filename}${result.auditRecorded === false ? t('；操作紀錄確認暫未收到', '; audit confirmation pending') : ''}`); setPreview(null); } }
    catch (e) { const message = (e as Error).message; if (message.includes('REPORT_PRIVACY_CHANGED') || message.includes('PREVIEW_EXPIRED')) { setPreview(null); setError(t('私隱設定已改動或預覽已過期，請重新建立報告預覽。', 'Privacy changed or the preview expired; prepare a new report preview.')); } else setError(message); } finally { setBusy(false); }
  };
  const pages = preview ? Math.ceil(preview.body.length / 20000) : 0;
  return <section className="inspector-panel" aria-label={pairedSelection ? "Paired comparison report" : undefined}><div className="inspector-panel-heading"><div><h2>{pairedSelection ? t('配對差異報告', 'Paired difference report') : diagnosticOnly ? diagnosticTable === 'detector-evaluation' ? t('偵測器測例報告', 'Detector fixture report') : diagnosticTable === 'tool-activity' ? t('工具操作彙總匯出', 'Tool activity export') : t('資料品質診斷匯出', 'Data quality diagnostic export') : t('分析及實驗報告', 'Analysis and experiment reports')}</h2><p>{diagnosticOnly ? diagnosticTable === 'detector-evaluation' ? t('合成案例、標籤政策、版本及 Precision／Recall；唔包含你嘅紀錄，唔受目前範圍篩選影響。', 'Synthetic cases, labels, versions and precision/recall; no user records or scope filtering.') : diagnosticTable === 'tool-activity' ? t('完整範圍統計、首20組工具及量測限制；保存内容同預覽完全相同。', 'Complete scoped totals, top 20 groups and measurement limitations; the saved file matches the frozen preview.') : t('只包含目前範圍嘅品質統計、格式指紋同來源進度；保存內容同預覽完全相同。', 'Quality counts, schema fingerprints and source progress in the current scope; the saved file matches the frozen preview.') : t('包含數據覆蓋、發現、建議、試驗結果同證據索引；保存嘅內容同預覽完全相同。', 'Coverage, findings, advice, trial outcomes and evidence references; the saved file matches the frozen preview.')}</p></div></div>
    {pairedSelection && <p aria-label="Paired report selection">{t('配對報告', 'Paired report')}: {pairedSelection.candidateVariant} − {pairedSelection.referenceVariant}</p>}
    <div className="inspector-form-grid">{!diagnosticOnly && !pairedSelection && <label>{t('報告範圍', 'Report scope')}<select value={contractId} onChange={e => { setContractId(e.target.value); setTable(e.target.value ? 'trials' : 'ledger'); }}><option value="">{t('目前帳本範圍', 'Current ledger scope')}</option>{contracts.map(contract => <option key={contract.id} value={contract.id}>{t('實驗：', 'Experiment: ')}{contract.objective.slice(0, 70)}</option>)}</select></label>}
      <label>{t('檔案格式', 'Format')}<select value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="markdown">Markdown</option><option value="json">JSON</option>{(!diagnosticOnly || diagnosticTable === 'tool-activity' || diagnosticTable === 'detector-evaluation') && <option value="csv">CSV</option>}</select></label>
      {format === 'csv' && !diagnosticOnly && !pairedSelection && <label>{t('資料表', 'Table')}<select value={table} onChange={e => setTable(e.target.value as typeof table)}>{!contractId && <><option value="ledger">{t('用量帳本', 'Usage ledger')}</option><option value="context-origins">{t('Context 來源', 'Context origins')}</option><option value="agent-comparison">{t('跨 Agent 共同操作', 'Cross-agent common operations')}</option><option value="findings">{t('發現與建議', 'Findings and advice')}</option></>}<option value="trials">{t('完整試驗紀錄', 'Trial population')}</option></select></label>}
    </div>
    {!diagnosticOnly && format !== 'csv' && <label className="inspector-checkbox"><input type="checkbox" checked={includeNotes} onChange={e => setIncludeNotes(e.target.checked)} />{t('包括我填寫嘅任務目標、驗收條件及試驗備註', 'Include my task definitions, acceptance criteria and trial notes')}</label>}
    <p className="inspector-footnote">{t('原始 Codex Prompt、程式碼及工具輸出唔會加入。實驗報告保留每筆匯入時嘅用量版本，唔會以最新數字覆蓋。', 'Raw Codex prompts, code and tool outputs are excluded. Experiment reports retain each import-time resource snapshot.')}</p>
    {error && <p role="alert" className="inspector-form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button className="inspector-action-button" disabled={busy} onClick={() => void prepare()}>{busy ? t('處理中…', 'Working…') : t('建立預覽', 'Prepare preview')}</button>
    {preview && <><p className="inspector-footnote">{t('建立報告時帳本版本', 'Ledger revision at report generation')}: {preview.revision} · {t('預覽有效 5 分鐘', 'Preview expires in 5 minutes')}</p>
      <div className="inspector-pagination"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>{t('上一頁', 'Previous')}</button><span>{page + 1} / {pages} · {t('完整報告分頁預覽', 'Complete report preview')}</span><button disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>{t('下一頁', 'Next')}</button></div>
      <pre className="inspector-report-preview" aria-label="Report preview page">{preview.body.slice(page * 20000, (page + 1) * 20000)}</pre>
      <button className="inspector-action-button" disabled={busy} onClick={() => void save()}>{t('保存呢份預覽', 'Save this exact preview')}</button>
    </>}
  </section>;
}
