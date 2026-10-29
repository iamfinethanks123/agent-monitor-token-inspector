import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { object, timestamp } from '../accounting/codex-observations';
import { integer } from '../accounting/integers';
import type { SpoolGapReason } from './protocol';

export const OFFLINE_MAX_BYTES = 16 * 1024 * 1024;
export interface OfflinePayload { schemaVersion: 'statistics-offline/1'; workspaceId: string; deviceId: string; createdAt: string; gap: { from: string; to: string; reason: SpoolGapReason } | null; packets: string[]; }
export interface OfflineArchive { payload: OfflinePayload; signature: string; }
export interface OfflinePreview { archiveId: string; deviceId: string; deviceName: string; createdAt: string; batchCount: number; eventCount: number; responseTokenSubtotal: string | null; responseMeasurements: number; counterMeasurements: number; newBatches: number; repeatedBatches: number; sequenceStart: string | null; sequenceEnd: string | null; currentAck: string; gap: OfflinePayload['gap']; issues: string[]; }

export function newOfflineSigningKey(): string { return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(); }
export function offlinePublicKey(privatePem: string): string {
  const key = createPrivateKey(privatePem); if (key.asymmetricKeyType !== 'ed25519') throw new Error('INVALID_OFFLINE_KEY');
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
}
export function validatePublicKey(input: unknown): string {
  if (typeof input !== 'string' || input.length !== 60 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) throw new Error('INVALID_OFFLINE_KEY');
  const key = createPublicKey({ key: Buffer.from(input, 'base64'), type: 'spki', format: 'der' });
  if (key.asymmetricKeyType !== 'ed25519' || key.export({ type: 'spki', format: 'der' }).toString('base64') !== input) throw new Error('INVALID_OFFLINE_KEY');
  return input;
}
export function signedArchive(payload: OfflinePayload, privatePem: string): OfflineArchive {
  const body = JSON.stringify(payload); if (Buffer.byteLength(body) > OFFLINE_MAX_BYTES - 256) throw new Error('OFFLINE_FILE_TOO_LARGE');
  return { payload, signature: sign(null, Buffer.from(body), createPrivateKey(privatePem)).toString('base64') };
}
export function verifyArchive(input: unknown, publicValue: string): OfflineArchive {
  const archive = object(input); if (!archive || Object.keys(archive).some(key => !['payload', 'signature'].includes(key))) throw new Error('INVALID_OFFLINE_FILE');
  const payload = object(archive.payload); if (!payload || Object.keys(payload).some(key => !['schemaVersion', 'workspaceId', 'deviceId', 'createdAt', 'gap', 'packets'].includes(key)) || payload.schemaVersion !== 'statistics-offline/1' || !timestamp(payload.createdAt) || !Array.isArray(payload.packets) || payload.packets.length > 2000 || !payload.packets.length && !payload.gap) throw new Error('INVALID_OFFLINE_FILE');
  if (typeof payload.workspaceId !== 'string' || typeof payload.deviceId !== 'string' || payload.packets.some(packet => typeof packet !== 'string' || Buffer.byteLength(packet) > 1024 * 1024)) throw new Error('INVALID_OFFLINE_FILE');
  if (payload.gap !== null) {
    const gap = object(payload.gap); if (!gap || Object.keys(gap).some(key => !['from', 'to', 'reason'].includes(key)) || !['bounded_spool', 'privacy_exclusion', 'multiple'].includes(String(gap.reason))) throw new Error('INVALID_GAP');
    if (integer(gap.from) === '0' || BigInt(integer(gap.to)) < BigInt(integer(gap.from))) throw new Error('INVALID_GAP');
  }
  if (typeof archive.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(archive.signature)) throw new Error('INVALID_OFFLINE_SIGNATURE');
  const body = JSON.stringify(payload); if (Buffer.byteLength(JSON.stringify(archive)) > OFFLINE_MAX_BYTES) throw new Error('OFFLINE_FILE_TOO_LARGE');
  const key = createPublicKey({ key: Buffer.from(validatePublicKey(publicValue), 'base64'), type: 'spki', format: 'der' });
  if (!verify(null, Buffer.from(body), key, Buffer.from(archive.signature, 'base64'))) throw new Error('INVALID_OFFLINE_SIGNATURE');
  return archive as unknown as OfflineArchive;
}
