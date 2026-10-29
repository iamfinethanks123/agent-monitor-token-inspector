import { useEffect, useState } from 'react';
import { Download, Monitor, Plus } from 'lucide-react';
import type { InspectorBridge, ReceiverView } from '../shared/inspector';
import { CollectorHealthPanel } from './CollectorHealthPanel';
import { OfflineImportPanel } from './OfflineImportPanel';
import { applyDeviceActivity } from '../shared/device-activity';

export function DevicesPanel({ api, language }: { api: InspectorBridge; language: 'zh' | 'en' }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [data, setData] = useState<ReceiverView>(); const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(false);
  useEffect(() => {
    let active = true, running = false, pending = false;
    const load = async () => {
      if (running) { pending = true; return; } running = true;
      try { const value = await api.devices(); if (active) { setData(value); setReadError(false); } }
      catch (e) { if (active) { if (!api.deviceActivity) setReadError(true); setError((e as Error).message); } }
      finally { running = false; if (active && pending) { pending = false; void load(); } }
    };
    void load(); const unsubscribe = api.onChanged(() => void load()); return () => { active = false; unsubscribe(); };
  }, [api]);
  useEffect(() => {
    if (!api.deviceActivity || !api.onDevicesChanged) return;
    const activity = api.deviceActivity; let active = true, running = false, pending = false;
    const load = async () => {
      if (running) { pending = true; return; } running = true;
      try { const value = await activity(); if (active) { setData(previous => applyDeviceActivity(previous, value)); setReadError(false); setError(''); } }
      catch (e) { if (active) { setReadError(true); setError((e as Error).message); } }
      finally { running = false; if (active && pending) { pending = false; void load(); } }
    };
    void load(); const unsubscribe = api.onDevicesChanged(() => void load()); const timer = setInterval(() => void load(), 60000);
    return () => { active = false; clearInterval(timer); unsubscribe(); };
  }, [api]);
  const enroll = async (deviceName: string, deviceId?: string) => {
    setBusy(true); setError('');
    try { const result = await api.enrollDevice(deviceName, deviceId); if (result.saved) { setMessage(`${t('已匯出：', 'Exported: ')}${result.filename}`); setName(''); setData(await api.devices()); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <><section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('新增 Client／Collector', 'Enroll a client / collector')}</h2><p>{t('匯出一次性配對設定，Client 匯入後加入呢個工作區。長期憑證由 OS 保護。', 'Export one-time pairing; the client joins this workspace with OS-protected credentials.')}</p></div><span className="inspector-badge">metadata only</span></div>
    <div className="inspector-inline-form"><input aria-label="New device name" value={name} onChange={e => setName(e.target.value)} placeholder="Windows Desktop / Ubuntu VPS" /><button className="inspector-action-button" disabled={!name.trim() || busy || !data?.listening} onClick={() => void enroll(name)}><Plus size={14} />{t('新增並匯出設定', 'Add & export pairing')}</button></div>
    <p className="inspector-footnote">{t('配對設定 10 分鐘後失效，只可使用一次。過期可以重新匯出；保留同一設備 ID，避免重複統計。遠端刪除同政策要等 Collector 完成套用並確認，先標示成功；在線唔等於政策已同步。', 'Pairing expires in 10 minutes and is single use. Re-export with the same device ID. Exclusions and policies are confirmed only after application and acknowledgement; being online does not establish policy synchronization.')}</p>
    {message && <p className="inspector-footnote">{message}</p>}{error && <p role="alert" className="inspector-form-error">{error}</p>}
    <div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>{t('設備', 'Machine')}</th><th>{t('配對／資料狀態', 'Enrollment / data state')}</th><th>{t('已核對用量', 'Canonical usage')}</th><th>{t('同步序號', 'Sync sequence')}</th><th>{t('刪除同步', 'Deletion sync')}</th><th>{t('政策同步', 'Policy sync')}</th><th>{t('管理', 'Manage')}</th></tr></thead><tbody>{data?.devices.map(device => <tr key={device.id}><td><Monitor size={13} /> {device.name}<small>{device.platform ?? t('未確認平台', 'Platform unverified')}</small></td><td>{device.state}{device.state !== 'local' && <small>{device.credentialConfirmedAt ? t('Collector 已確認憑證可讀取', 'Collector confirmed stored credentials') : t('憑證持久化未確認', 'Credential persistence unconfirmed')}</small>}{device.state !== 'local' && <small>{device.online ? t('最近三分鐘有認證連線', 'Authenticated contact within three minutes') : t('離線／連線資料較舊', 'Offline / older contact')}{device.lastIngestMode === 'offline' ? t(' · 最近資料來自離線檔案', ' · last data from offline file') : ''}</small>}{device.state === 'active' && <small>{device.offlineRegisteredAt ? t('已登記離線簽署', 'Offline signing registered') : t('離線簽署未啟用', 'Offline signing not enabled')}</small>}<small>{device.state === 'local' ? t('本機只讀索引', 'Local read-only index') : device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }) : t('未收到資料', 'No data received')}</small></td><td>{device.total === null ? t('未知／未收到', 'Unknown / not received') : BigInt(device.total).toLocaleString('en-US')}<small>tokens</small></td><td>{device.acknowledgedSequence}{device.transportGaps > 0 && <small>{t(`${device.transportGaps} 個已記錄傳輸序號缺口`, `${device.transportGaps} recorded transport gaps`)}</small>}</td><td>{device.state === 'local' ? t('本機生效', 'Applied locally') : <>{device.pendingDeletions > 0 ? t(`${device.pendingDeletions} 個來源等候 Client 排除`, `${device.pendingDeletions} source exclusions pending`) : t('沒有待處理要求', 'No pending requests')}<small>{t(`${device.appliedDeletions} 個來源已收到 Collector 確認`, `${device.appliedDeletions} exclusions confirmed by collector`)}</small></>}</td><td>{device.projectPolicySync?.state==='local'?t('本機生效','Applied locally'):device.projectPolicySync?.state==='revoked'?t('已撤銷','Revoked'):device.projectPolicySync?<><span>{device.projectPolicySync.state==='applied'?t('Collector 已確認目前政策','Collector confirmed current policies'):t(`${device.projectPolicySync.pending} 項待確認`,`${device.projectPolicySync.pending} policies await confirmation`)}</span><small>{t(`版本 ${device.projectPolicySync.version}・已確認 ${device.projectPolicySync.applied} 項`,`Version ${device.projectPolicySync.version} · ${device.projectPolicySync.applied} confirmed`)}</small>{device.projectPolicySync.lastAppliedAt&&<small>{new Date(device.projectPolicySync.lastAppliedAt).toLocaleString('zh-HK',{timeZone:'Asia/Hong_Kong'})}</small>}</>:t('未收到政策確認','Policy confirmation unavailable')}</td><td>{device.state !== 'local' && <div className="inspector-device-actions"><button className="inspector-link" disabled={busy} onClick={() => void enroll(device.name, device.id)}><Download size={12} />{t('重新匯出配對', 'Re-export pairing')}</button><button className="inspector-link" disabled={busy || device.state === 'revoked'} onClick={async () => { try { await api.revokeDevice(device.id); setData(await api.devices()); } catch (e) { setError((e as Error).message); } }}>{t('撤銷（保留歷史）', 'Revoke · retain history')}</button></div>}</td></tr>)}</tbody></table></div>
    <p className="inspector-footnote">{t('接收端只監聽本機。遠端 Client 使用 SSH tunnel 或 HTTPS；Prompt、程式碼、工具輸出同完整路徑不會傳送。', 'Receiver is loopback-only. Remote clients use an SSH tunnel or HTTPS; prompts, code, tool outputs and full paths are excluded.')}</p>
    <p className="inspector-footnote">{t('連線、健康同政策可獨立更新；用量小計保留最近核對結果，收到新用量後更新。帳本版本：', 'Connectivity, health and policies update independently; usage keeps its latest reconciled snapshot until new usage arrives. Ledger revision: ')}{data?.usageRevision ?? '—'}</p>
  </section><CollectorHealthPanel devices={data?.devices} language={language} failed={readError} /><OfflineImportPanel api={api} language={language} /></>;
}
