import { timelineInvestigations } from '../diagnostics/timeline-investigations';
import { explainLedger } from '../storage/ledger-explanation';
import { explainTotal, explainTotalPage } from '../storage/total-explanation';
import { dataQuality } from '../diagnostics/data-quality';
import { sourceAvailability } from './source-availability';
import { modelTransitions } from '../diagnostics/model-transitions';
import { benchmarkExecutions, recordBenchmarkExecution, recoverInterruptedBenchmarks } from '../benchmarks/executions';
import { contextAttribution } from '../diagnostics/context-attribution';
import { parentPort, workerData } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { REPARSE_STATE_KEY,recoverReparseState } from './reparse-state';
import { InspectorStore } from '../storage/InspectorStore';
import { IndexCollector } from './IndexCollector';
import type { InspectorStatus } from '../shared/inspector';
import { readLegacyStats } from '../storage/LegacyStats';
import { agentComparison, setAgentPurpose, annotateAgentComparison } from '../diagnostics/agent-comparison';
import { analyze, toolsPage, toolActivity } from '../diagnostics/analyze';
import { budgets, experiments, importTrial, saveContract, setBudget } from '../benchmarks/experiments';
import { report } from '../reporting/report';
import { MetadataReceiver } from '../transport/MetadataReceiver';
import { priceAnalytics, savePrice } from '../accounting/prices';
import { addRoot, applyRetention, deleteSource, deleteProject, projectDeletionPlan, privacy, roots, setRetention, retentionPlan, setRoot } from '../storage/privacy';
import { setProjectPolicy, projectPolicyPlan, assertReportPrivacy, sourcePreviewAllowed, previewPermissions } from '../storage/project-privacy';
import { ResourceMeter } from './resources';
import { quotas } from '../storage/quotas';
import { manifests, importManifests, setManifestConsent } from '../storage/context-manifests';
import { checkAlerts, incidents, recordFindings, removeSuppression, suppressAlerts } from '../diagnostics/incidents';
import { removeBudget } from '../diagnostics/budgets';
import { evaluateBudgets } from '../diagnostics/budgets';
import { timeCharts } from '../accounting/time-charts';
import { manualUsd, setManualUsdPrice, clearManualUsdPrice } from '../accounting/manual-usd';
import { timeline, timelineState } from '../storage/timeline';
import { contentSearch } from '../storage/local-content';
import { scopeOptions } from '../storage/scope';
import { storageBlockReason } from './storage-failure';
import { runTask } from '../benchmarks/run-task';

const port = parentPort;
if (!port) throw new Error('WORKER_PORT_UNAVAILABLE');
const meter = new ResourceMeter(workerData.database as string);
const store = new InspectorStore(workerData.database as string);
let reparseState = recoverReparseState(store);
if(reparseState) port!.postMessage({type:'reparse-progress',value:reparseState});
recoverInterruptedBenchmarks(store);
const collector = new IndexCollector(store, workerData.roots as string[] | undefined, workerData.fingerprintKey as string | undefined);
async function setupRoots(): Promise<void> {
  if (!roots(store).length) for (const root of collector.roots) await addRoot(store, root).catch(() => undefined);
  const configured = roots(store); if (configured.length) collector.roots.splice(0, collector.roots.length, ...configured.filter(root => root.enabled).map(root => root.path));
}
const status: InspectorStatus = { phase: 'starting', lastScanAt: null, errors: [], fingerprinting: workerData.fingerprintKey ? 'available' : 'unavailable' };
const receiver = new MetadataReceiver(store);
receiver.onChanged = () => { if(reparseState?.state!=='running') port!.postMessage({ type: 'changed' }); };
receiver.onDevicesChanged = () => port!.postMessage({ type: 'devices-changed' });
void receiver.start(workerData.receiverPort ?? 9897).then(() => receiver.onChanged?.()).catch(() => { receiver.error = 'RECEIVER_UNAVAILABLE'; receiver.onChanged?.(); });
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let scanPromise: Promise<void> | undefined;
let lastSignature = '';
let lastRetention = 0;
let reparsePromise: Promise<unknown> | undefined;
let reparseAbort: AbortController | undefined;
let alertsStarted = false;
let indexChangedTimer: ReturnType<typeof setTimeout> | undefined;
function indexChanged(): void {
  if (indexChangedTimer || stopped || reparseState?.state==='running') return;
  indexChangedTimer = setTimeout(() => { indexChangedTimer = undefined; if (!stopped) port!.postMessage({ type: 'changed', status }); }, 100);
  indexChangedTimer.unref();
}
collector.onProgress = indexChanged;
function reparseChanged():void { if(!reparseState)return;store.setSetting(REPARSE_STATE_KEY,JSON.stringify(reparseState));port!.postMessage({type:'reparse-progress',value:reparseState}); }
collector.onReparseProgress=(result,totalSources)=>{if(reparseState?.state!=='running')return;reparseState={...reparseState,totalSources,sourcesReparsed:result.sourcesReparsed,unavailable:result.unavailable.length,revision:store.revision(),updatedAt:new Date().toISOString()};reparseChanged();};

async function scan(): Promise<void> {
  if (reparsePromise) { await reparsePromise; return; }
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    status.phase = 'indexing';
    try {
      await collector.scan();
      if (Date.now() - lastRetention > 3600000) { applyRetention(store); lastRetention = Date.now(); }
      checkAlerts(store, Date.now(), !alertsStarted); alertsStarted = true;
      status.errors = [...new Set([...collector.errors, ...(store.compactionPending ? ['STORAGE_COMPACTION_PENDING'] : [])])].slice(-10);
      status.phase = status.errors.length ? 'degraded' : 'ready';
      status.lastScanAt = new Date().toISOString();
    } catch (error) {
      status.phase = 'degraded'; status.errors = [`INDEX_FAILED:${(error as NodeJS.ErrnoException).code ?? 'STORAGE_UNAVAILABLE'}`];
      const reason = storageBlockReason(error);
      if (reason) { status.scanBlocked = { reason, detectedAt: new Date().toISOString() }; status.errors = [reason]; port!.postMessage({ type: 'changed', status }); }
    }
    const signature = JSON.stringify([store.revision(), store.observationCount(), status.phase, status.errors]);
    if (signature !== lastSignature) {
      if (!lastSignature && reparseState?.state !== 'running') { if (indexChangedTimer) clearTimeout(indexChangedTimer); indexChangedTimer = undefined; port!.postMessage({ type: 'changed', status }); }
      else indexChanged();
      lastSignature = signature;
    }
  })().finally(() => { scanPromise = undefined; });
  return scanPromise;
}

function schedule(): void {
  if (stopped || status.scanBlocked || timer) return;
  timer = setTimeout(() => { timer = undefined; void scan().finally(schedule); }, 1000); timer.unref();
}

port.on('message', async (message: { id: number; method: string; payload?: unknown }) => {
  const { id, method, payload } = message;
  port!.postMessage({ type: 'started', id });
  try {
    let value;
    switch (method) {
      case 'summary': value = store.summary(payload); break;
      case 'ledger': value = store.ledger(payload); break;
      case 'ledger-explanation': value = explainLedger(store, payload); break;
      case 'total-explanation': value = explainTotal(store, payload); break;
      case 'total-explanation-page': value = explainTotalPage(store, payload); break;
      case 'events': value = store.events(payload); break;
      case 'timeline': value = timeline(store, payload); break;
      case 'content-search': value = contentSearch(store, payload); break;
      case 'timeline-investigations': value = timelineInvestigations(store, payload); break;
      case 'timeline-state': value = timelineState(store); break;
      case 'scope-options': value = scopeOptions(store); break;
      case 'data-quality': value = dataQuality(store,payload); break;
      case 'source-availability': value = await sourceAvailability(store, collector.roots, payload); break;
      case 'model-transitions': value = modelTransitions(store,payload); break;
      case 'sources': value = store.sources(); break;
      case 'analytics': value = store.analytics(payload); break;
      case 'time-charts': { const input = payload as { query: unknown; windowMinutes: unknown; bucketMinutes: unknown }; if (!input) throw new Error('INVALID_CHART_TIME'); value = timeCharts(store, input.query, input.windowMinutes, input.bucketMinutes); break; }
      case 'quotas': value = quotas(store, payload); break;
      case 'context-attribution': value = contextAttribution(store, payload); break;
      case 'manifests': value = manifests(store, payload); break;
      case 'manifest-consent': setManifestConsent(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'manifest-import': value = importManifests(store, payload); port!.postMessage({ type: 'changed' }); break;
      case 'legacy': value = readLegacyStats(workerData.legacyDatabase as string | undefined); break;
      case 'agent-comparison': value = agentComparison(store, payload); break;
      case 'comparison-annotate': annotateAgentComparison(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'agent-purpose': setAgentPurpose(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'diagnostics': { const result = analyze(store, payload); recordFindings(store, result.findings); value = result; break; }
      case 'incidents': value = incidents(store, payload); break;
      case 'alerts-suppress': suppressAlerts(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'alerts-unsuppress': removeSuppression(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'tools': value = toolsPage(store, payload); break;
      case 'tool-activity': value = toolActivity(store, payload); break;
      case 'annotate': {
        const action = payload as { id: string; choice: unknown };
        if (!action || typeof action.id !== 'string') throw new Error('INVALID_ANNOTATION');
        store.annotate(action.id, action.choice); port!.postMessage({ type: 'changed' }); value = null; break;
      }
      case 'benchmark-executions': value = benchmarkExecutions(store, payload); break;
      case 'benchmark-record': recordBenchmarkExecution(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'experiments': value = experiments(store, payload); break;
      case 'run-task': value = runTask(store, payload); break;
      case 'contract': value = saveContract(store, payload); port!.postMessage({ type: 'changed' }); break;
      case 'trial': value = importTrial(store, payload); port!.postMessage({ type: 'changed' }); break;
      case 'budgets': value = budgets(store); break;
      case 'budget': setBudget(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'budget-remove': removeBudget(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'prices': { const input = payload as { query?: unknown; mode?: unknown }; value = priceAnalytics(store, input?.query, input?.mode); break; }
      case 'price-save': value = savePrice(store, payload); port!.postMessage({ type: 'changed' }); break;
      case 'manual-usd': value = manualUsd(store, payload); break;
      case 'manual-usd-set': value = setManualUsdPrice(store, payload); port!.postMessage({ type: 'changed' }); break;
      case 'manual-usd-clear': clearManualUsdPrice(store); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'privacy': value = privacy(store); break;
      case 'project-policy-plan': value = projectPolicyPlan(store, payload); break;
      case 'project-set': setProjectPolicy(store, payload); applyRetention(store); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'project-delete-plan': value = projectDeletionPlan(store, payload); break;
      case 'project-delete': deleteProject(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'report-privacy-check': assertReportPrivacy(store, payload); value = null; break;
      case 'trace-privacy': value = sourcePreviewAllowed(store, payload); break;
      case 'preview-permissions': value = previewPermissions(store, payload); break;
      case 'root-add': await addRoot(store, payload); await setupRoots(); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'root-set': setRoot(store, payload); await setupRoots(); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'retention-set': setRetention(store, payload); applyRetention(store); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'retention-plan': value = retentionPlan(store, payload); break;
      case 'source-delete': deleteSource(store, payload); port!.postMessage({ type: 'changed' }); value = null; break;
      case 'reparse-cancel': {
        if (typeof payload !== 'string' || !/^[a-f0-9-]{36}$/.test(payload)) throw new Error('INVALID_REPARSE_OPERATION');
        if (payload !== reparseState?.id) throw new Error('REPARSE_OPERATION_CHANGED');
        const requested = reparseState.state === 'running' && !!reparseAbort;
        if (requested) reparseAbort!.abort();
        value = { requested }; break;
      }
      case 'reindex': {
        if (!reparsePromise) {
          reparseAbort=new AbortController();const now=new Date().toISOString();reparseState={schemaVersion:'reparse-operation/1',id:randomUUID(),state:'running',startedAt:now,updatedAt:now,finishedAt:null,totalSources:null,sourcesReparsed:0,unavailable:0,revision:store.revision(),error:null};if(indexChangedTimer){clearTimeout(indexChangedTimer);indexChangedTimer=undefined;}reparseChanged();
          reparsePromise=(async()=>{try{if(scanPromise)await scanPromise;const result=await collector.reparse(reparseAbort!.signal);evaluateBudgets(store,new Set(),new Set(store.sources().map(source=>source.id)),Date.now());const finishedAt=new Date().toISOString();const complete=reparseState!.totalSources!==null&&result.sourcesReparsed+result.unavailable.length===reparseState!.totalSources;reparseState={...reparseState!,state:result.cancelled?'cancelled':complete?'completed':'interrupted',error:result.cancelled||complete?null:'INDEX_STOPPED',sourcesReparsed:result.sourcesReparsed,unavailable:result.unavailable.length,revision:result.revision,updatedAt:finishedAt,finishedAt};return result;}catch(error){const finishedAt=new Date().toISOString();reparseState={...reparseState!,state:'failed',error:'REPARSE_FAILED',updatedAt:finishedAt,finishedAt};throw error;}finally{reparseChanged();reparsePromise=undefined;reparseAbort=undefined;port!.postMessage({type:'changed'});}})();
        }
        value = await reparsePromise; break;
      }
      case 'report': {
        const request = payload as { query: unknown; format: unknown; options?: unknown }; if (!request) throw new Error('INVALID_FORMAT');
        value = report(store, request.query, request.format, request.options); break;
      }
      case 'report-exported': {
        const entry = payload as { revision: unknown; format: unknown };
        if (!entry || !Number.isSafeInteger(entry.revision) || !['markdown', 'json', 'csv', 'clipboard'].includes(String(entry.format))) throw new Error('INVALID_REPORT_AUDIT');
        store.audit(entry.format === 'clipboard' ? 'report.copy' : 'report.export', `${entry.revision}:${entry.format}`); value = null; break;
      }
      case 'devices': value = receiver.view(); break;
      case 'device-activity': value = receiver.activity(); break;
      case 'offline-preview': value = receiver.offlinePreview(payload); break;
      case 'offline-import': value = receiver.importOffline(payload); port!.postMessage({ type: 'changed' }); break;
      case 'enroll': { const input = payload as { name: unknown; deviceId?: unknown }; if (!input) throw new Error('INVALID_DEVICE'); value = receiver.enroll(input.name, input.deviceId); break; }
      case 'revoke': receiver.revoke(payload); value = null; break;
      case 'status': value = { ...status, resources: meter.sample() }; break;
      case 'fingerprint-key':
        if (typeof payload !== 'string' || !/^[a-zA-Z0-9+/]{43}=$/.test(payload)) throw new Error('INVALID_FINGERPRINT_KEY');
        collector.setFingerprintKey(payload); status.fingerprinting = 'available'; port!.postMessage({ type: 'changed' }); value = null; break;
      case 'evidence': value = await collector.evidence(payload as string); break;
      case 'refresh':
        status.scanBlocked = undefined;
        await scan();
        schedule();
        if (indexChangedTimer) { clearTimeout(indexChangedTimer); indexChangedTimer = undefined; }
        if (reparseState?.state !== 'running') port!.postMessage({ type: 'changed' });
        value = null; break;
      case 'stop':
        stopped = true; if (timer) clearTimeout(timer); if (indexChangedTimer) clearTimeout(indexChangedTimer); collector.stop();
        if (scanPromise) await scanPromise; if (reparsePromise) await reparsePromise; await receiver.stop(); store.close(); value = null; break;
      default: throw new Error('UNSUPPORTED_METHOD');
    }
    port!.postMessage({ type: 'response', id, value });
    if (method === 'stop') port!.close();
  } catch (error) {
    const text = (error as Error).message;
    port!.postMessage({ type: 'response', id, error: /^[A-Z_]+$/.test(text) ? text : 'STORAGE_UNAVAILABLE' });
  }
});

void setupRoots().then(() => { store.ensureAccountingPolicy(); port!.postMessage({ type: 'ready' }); return scan(); }).catch(() => { port!.postMessage({ type: 'initialization-error' }); }).finally(schedule);
