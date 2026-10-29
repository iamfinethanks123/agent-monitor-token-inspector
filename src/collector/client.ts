import { collectorHealth } from './health-summary';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { InspectorStore } from '../storage/InspectorStore';
import { applyRetention } from '../storage/privacy';
import { IndexCollector } from './IndexCollector';
import { loadCredential, saveCredential } from './ProtectedCredentials';
import { protectedEndpoint, type PairingConfig } from '../transport/protocol';
import { enqueue, sendSpool, pruneSpool, request, recoverPrivacyReset, expireCollectorRetention, synchronizeDeletions, synchronizeProjectPolicies, confirmEnrollment, type ClientConfig } from './metadata-sync';
import { newOfflineSigningKey, offlinePublicKey } from '../transport/offline';
import { exportOffline } from './offline-export';
import { clientLock } from './client-lock';
import type { CollectorCredential } from './ProtectedCredentials';

const dataRoot = process.env.AGENT_MONITOR_CLIENT_STATE ?? (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Agent Monitor Collector') : path.join(os.homedir(), '.local', 'share', 'agent-monitor-collector', 'state'));
const configFile = path.join(dataRoot, 'client.json');
let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });

async function atomicJson(filename: string, value: unknown): Promise<void> {
  const temporary = `${filename}.tmp`; const file = await fs.open(temporary, 'w', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await fs.rename(temporary, filename);
  if (process.platform !== 'win32') { const directory = await fs.open(path.dirname(filename), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
}
function id(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) throw new Error('INVALID_PAIRING'); return value; }

async function pair(filename: string): Promise<void> {
  const input = await fs.readFile(filename, 'utf8'); if (input.length > 8192) throw new Error('INVALID_PAIRING');
  const config = JSON.parse(input) as PairingConfig;
  if (config.schemaVersion !== '2' || Date.parse(config.expiresAt) < Date.now() || !/^[A-Za-z0-9_-]{40,64}$/.test(config.pairingCode)) throw new Error('PAIRING_EXPIRED');
  id(config.workspaceId); id(config.deviceId); protectedEndpoint(config.endpoint);
  // Protect an existing enrollment from being silently replaced by another identity.
  const existing = await fs.readFile(configFile, 'utf8').catch(() => null);
  if (existing) { const old = JSON.parse(existing) as ClientConfig; if (old.workspaceId !== config.workspaceId || old.deviceId !== config.deviceId) throw new Error('EXISTING_ENROLLMENT'); }
  const previous = existing ? await loadCredential((JSON.parse(existing) as ClientConfig).credentialFile) : null;
  await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const reply = await request(config.endpoint, '/v2/pair', { workspaceId: config.workspaceId, deviceId: config.deviceId, pairingCode: config.pairingCode, platform: `${process.platform}-${process.arch}` });
  if (typeof reply.deviceToken !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(reply.deviceToken)) throw new Error('INVALID_RECEIVER_RESPONSE');
  const credentialFile = path.join(dataRoot, process.platform === 'linux' ? 'device.cred' : 'device.enc');
  const credential = { token: reply.deviceToken, fingerprintKey: previous?.fingerprintKey ?? randomBytes(32).toString('base64'), offlineSigningKey: previous?.offlineSigningKey ?? newOfflineSigningKey() };
  await saveCredential(credentialFile, credential);
  await atomicJson(configFile, { schemaVersion: '2', workspaceId: config.workspaceId, deviceId: config.deviceId, deviceName: config.deviceName, endpoint: protectedEndpoint(config.endpoint), credentialFile });
  await confirmEnrollment(JSON.parse(await fs.readFile(configFile, 'utf8')) as ClientConfig, await loadCredential(credentialFile));
  const saved = JSON.parse(await fs.readFile(configFile, 'utf8')) as ClientConfig;
  if (await registerOffline(saved, credential)) { saved.offlinePublicKey = offlinePublicKey(credential.offlineSigningKey); await atomicJson(configFile, saved); }
  console.log('PAIRED: device credential protected by the operating system.');
}

async function run(): Promise<void> {
  const config = JSON.parse(await fs.readFile(configFile, 'utf8')) as ClientConfig; id(config.workspaceId); id(config.deviceId); protectedEndpoint(config.endpoint);
  const credential = await loadCredential(config.credentialFile); const store = new InspectorStore(path.join(dataRoot, 'index.sqlite'), { workspaceId: config.workspaceId, machineId: config.deviceId });
  const collector = new IndexCollector(store, undefined, credential.fingerprintKey); const spool = path.join(dataRoot, 'spool'); await fs.mkdir(spool, { recursive: true, mode: 0o700 });
  let healthSupported = true;
  let failures = 0; let confirmed = false; let offlineRegistered = false;
  try {
    while (!stopping) {
      try { await recoverPrivacyReset(store, config, spool); await expireCollectorRetention(store, config, spool); await collector.scan(); await enqueue(store, config, credential, spool, () => stopping); await pruneSpool(store, spool); if (!confirmed) confirmed = await confirmEnrollment(config, credential); if (!offlineRegistered) { offlineRegistered = await registerOffline(config, credential); if (offlineRegistered && config.offlinePublicKey !== offlinePublicKey(credential.offlineSigningKey!)) { config.offlinePublicKey = offlinePublicKey(credential.offlineSigningKey!); await atomicJson(configFile, config); } } await synchronizeDeletions(store, config, credential, spool); await synchronizeProjectPolicies(store, config, credential, spool); await sendSpool(store, config, credential, spool, () => stopping); await request(config.endpoint, '/v2/heartbeat', { workspaceId: config.workspaceId }, config, credential);
        if (healthSupported) {
          try { await request(config.endpoint, '/v2/collector-health', { workspaceId: config.workspaceId, health: collectorHealth(store,collector.errors.length) }, config, credential); }
          catch(error) { const code=(error as Error).message;if(code==='UNSUPPORTED_METHOD')healthSupported=false;else console.log(`COLLECTOR_HEALTH: ${/^[A-Z_]+$/.test(code)?code:'UNAVAILABLE'}`); }
        }
        failures = 0; console.log(`SYNCED: sequence ${store.getSetting('acknowledged_sequence') ?? '0'}`); }
      catch (error) {
        failures++; const failure = error as Error & { code?: unknown; cause?: { code?: unknown } }; const code = failure.message;
        const detail = failure.name === 'TimeoutError' ? 'RECEIVER_TIMEOUT' : failure.code ?? failure.cause?.code;
        const safe = /^[A-Z_]+$/.test(code) ? code : typeof detail === 'string' && /^[A-Z0-9_]{1,64}$/.test(detail) ? detail : 'OFFLINE';
        console.log(`COLLECTOR: ${safe}`);
      }
      const until = Date.now() + Math.min(60000, failures ? 5000 * 2 ** Math.min(failures, 4) : 30000);
      while (!stopping && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally { collector.stop(); store.close(); }
}

async function registerOffline(config: ClientConfig, credential: CollectorCredential): Promise<boolean> {
  if (!credential.offlineSigningKey) return false;
  try { const reply = await request(config.endpoint, '/v2/offline/register', { workspaceId: config.workspaceId, publicKey: offlinePublicKey(credential.offlineSigningKey) }, config, credential); return reply.registered === true; }
  catch (error) { if (['UNSUPPORTED_METHOD', 'OFFLINE_KEY_CONFLICT'].includes((error as Error).message)) return false; throw error; }
}
async function enableOffline(): Promise<void> {
  const config = JSON.parse(await fs.readFile(configFile, 'utf8')) as ClientConfig; id(config.workspaceId); id(config.deviceId); protectedEndpoint(config.endpoint);
  const credential = await loadCredential(config.credentialFile, true);
  if (!credential.offlineSigningKey) { credential.offlineSigningKey = newOfflineSigningKey(); await saveCredential(config.credentialFile, credential); }
  const reopened = await loadCredential(config.credentialFile, true);
  if (!reopened.offlineSigningKey || offlinePublicKey(reopened.offlineSigningKey) !== offlinePublicKey(credential.offlineSigningKey)) throw new Error('OFFLINE_KEY_PERSISTENCE_UNCONFIRMED');
  if (!await registerOffline(config, reopened)) throw new Error('OFFLINE_RECEIVER_UNAVAILABLE');
  config.offlinePublicKey = offlinePublicKey(reopened.offlineSigningKey); await atomicJson(configFile, config);
  console.log('OFFLINE_SIGNING_READY: private key remains in OS-protected storage.');
}
async function offlineExport(directory: string): Promise<void> {
  const config = JSON.parse(await fs.readFile(configFile, 'utf8')) as ClientConfig; id(config.workspaceId); id(config.deviceId); protectedEndpoint(config.endpoint);
  const credential = await loadCredential(config.credentialFile, true); if (!credential.offlineSigningKey || config.offlinePublicKey !== offlinePublicKey(credential.offlineSigningKey)) throw new Error('RUN_ENABLE_OFFLINE_WHILE_CONNECTED');
  const store = new InspectorStore(path.join(dataRoot, 'index.sqlite'), { workspaceId: config.workspaceId, machineId: config.deviceId });
  const spool = path.join(dataRoot, 'spool'); await fs.mkdir(spool, { recursive: true, mode: 0o700 });
  try { await recoverPrivacyReset(store, config, spool); await expireCollectorRetention(store, config, spool); const collector = new IndexCollector(store, undefined, credential.fingerprintKey); await collector.scan(); await enqueue(store, config, credential, spool); const result = await exportOffline(store, config, credential, spool, directory); console.log(result.files.length ? `OFFLINE_EXPORTED: ${result.files.length} files; ${result.batches} batches. ACK awaits authenticated reconnect.` : 'OFFLINE_UP_TO_DATE: no pending batches to export.'); }
  finally { store.close(); }
}
async function localRun(root?: string): Promise<void> {
  const store = new InspectorStore(path.join(dataRoot, 'local-index.sqlite')); const collector = new IndexCollector(store, root ? [path.resolve(root)] : undefined);
  try { do { applyRetention(store); await collector.scan(); console.log(`LOCAL_INDEXED: ${store.observationCount()} metadata records; networking disabled.`); if (process.argv.includes('--once')) break; const until = Date.now() + 30000; while (!stopping && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 250)); } while (!stopping); }
  finally { collector.stop(); store.close(); }
}
const [mode, argument] = process.argv.slice(2);
async function main(): Promise<void> {
  const release = await clientLock(dataRoot);
  try { if (mode === 'pair' && argument) await pair(argument); else if (mode === 'run') await run(); else if (mode === 'enable-offline') await enableOffline(); else if (mode === 'export-offline' && argument) await offlineExport(argument); else if (mode === 'local') await localRun(argument && argument !== '--once' ? argument : undefined); else throw new Error('USAGE_PAIR_RUN_LOCAL_ENABLE_OFFLINE_EXPORT_OFFLINE'); }
  finally { await release(); }
}
void main().catch(error => {
  const code = (error as Error).message; console.error(/^[A-Z_]+$/.test(code) ? code : 'COLLECTOR_FAILED'); process.exitCode = 1;
});
