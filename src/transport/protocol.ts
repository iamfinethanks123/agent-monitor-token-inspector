import type { SourceContext, UsageMeasurement } from '../accounting/codex-observations';

export interface PairingConfig {
  schemaVersion: '2'; workspaceId: string; deviceId: string; deviceName: string; endpoint: string;
  pairingCode: string; expiresAt: string;
}
export interface MetadataEvent {
  id: string; sourceId: string; generation: number; byteStart: string; byteEnd: string; line: number; semanticSequence: string | null;
  timestamp: string | null; kind: 'token_usage_record' | 'event_msg/token_count'; schemaFingerprint: string;
  context: Pick<SourceContext, 'threadId' | 'sessionId' | 'parentThreadId' | 'forkedFromId' | 'runtimeVersion' | 'requestedModel' | 'providerRoute' | 'serviceTier' | 'projectId' | 'turnId'>;
  measurements: UsageMeasurement[];
}
export interface MetadataBatch {
  schemaVersion: '2'; workspaceId: string; deviceId: string; batchId: string; sequenceStart: string; sequenceEnd: string; createdAt: string;
  adapterVersion: 'codex-passive/1'; redactionPolicyId: 'statistics-only-v2'; events: MetadataEvent[];
}
export interface BatchAck { acknowledgedSequence: string; serverTime: string; }
export interface SourceDeletion { sourceId: string; deletionId: string; }
export interface ProjectPolicyConstraint { projectId: string; metadataDays: number; usageDays: number; contentDays: number | null; allowExports: boolean; allowSourcePreview: boolean; excluded: boolean; }
export interface ProjectPolicyControl { version: string; controlId: string; policy: ProjectPolicyConstraint; }
export type SpoolGapReason = 'bounded_spool' | 'privacy_exclusion' | 'multiple';

export function protectedEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('INVALID_ENDPOINT');
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('ENCRYPTED_TRANSPORT_REQUIRED');
  return value.replace(/\/$/, '');
}
