import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { InspectorStore } from '../storage/InspectorStore';
import type { CollectorCredential } from './ProtectedCredentials';
import { pruneSpool, unprotect, type ClientConfig } from './metadata-sync';
import { signedArchive, type OfflinePayload } from '../transport/offline';

/** Export approved queued metadata; exporting never advances ACK or deletes queued batches. */
export async function exportOffline(store: InspectorStore, config: ClientConfig, credential: CollectorCredential, spool: string, directory: string): Promise<{ files: string[]; batches: number }> {
  if (!credential.offlineSigningKey) throw new Error('OFFLINE_SIGNING_NOT_ENABLED');
  const output = path.resolve(directory); if (output.split(path.sep).some(part => part.toLowerCase() === '.codex')) throw new Error('FORBIDDEN_SOURCE');
  await fs.mkdir(output, { recursive: true, mode: 0o700 }); if ((await fs.lstat(output)).isSymbolicLink()) throw new Error('FORBIDDEN_SOURCE');
  await pruneSpool(store, spool);
  const names = (await fs.readdir(spool)).filter(name => /^\d+-\d+\.enc$/.test(name)).sort(); const files: string[] = []; let batches = 0; let packets: string[] = [];
  let gap = JSON.parse(store.getSetting('spool_gap') ?? 'null') as OfflinePayload['gap'];
  const write = async () => {
    if (!packets.length && !gap) return;
    const first = packets.length ? JSON.parse(packets[0]).sequenceStart : gap!.from; const last = packets.length ? JSON.parse(packets.at(-1)!).sequenceEnd : gap!.to;
    const archive = signedArchive({ schemaVersion: 'statistics-offline/1', workspaceId: config.workspaceId, deviceId: config.deviceId, createdAt: new Date().toISOString(), gap, packets }, credential.offlineSigningKey!);
    const filename = path.join(output, `usage-${String(first).padStart(20, '0')}-${String(last).padStart(20, '0')}-${Date.now()}.codexstats.json`);
    const file = await fs.open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { await file.writeFile(JSON.stringify(archive)); await file.sync(); } finally { await file.close(); }
    files.push(filename); packets = []; gap = null;
  };
  for (const name of names) {
    if (BigInt(name.replace('.enc', '').split('-')[1]) <= BigInt(store.getSetting('acknowledged_sequence') ?? '0')) continue;
    const handle = await fs.open(path.join(spool, name), constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); if (!handle) continue;
    let encrypted: string;
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('INVALID_SPOOL'); encrypted = await handle.readFile('utf8'); } finally { await handle.close(); }
    const raw = unprotect(encrypted, credential); const packet = JSON.parse(raw);
    if (packet.workspaceId !== config.workspaceId || packet.deviceId !== config.deviceId || packet.schemaVersion !== '2' || packet.redactionPolicyId !== 'statistics-only-v2') throw new Error('INVALID_SPOOL');
    if (packets.length && Buffer.byteLength(JSON.stringify([...packets, raw])) > 8 * 1024 * 1024) await write();
    packets.push(raw); batches++;
  }
  await write();
  if (process.platform !== 'win32') { const folder = await fs.open(output, 'r'); try { await folder.sync(); } finally { await folder.close(); } }
  store.audit('offline.export', `${batches}:${files.length}`); return { files, batches };
}
