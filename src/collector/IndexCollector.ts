import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore, type SourceCursor, type PendingObservation } from '../storage/InspectorStore';
import { projectPolicy, privacyVersion } from '../storage/project-privacy';
import { EMPTY_CONTEXT, normalizeCodex, digest, ADAPTER_VERSION } from '../accounting/codex-observations';
import { parseLossless } from '../accounting/integers';
import { redactText } from '../reporting/privacy';
import { captureContent } from '../storage/local-content';
import type { EvidenceView, ReparseResult } from '../shared/inspector';
import { storageBlockReason } from './storage-failure';

const CHUNK_BYTES = 64 * 1024;
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const yieldTurn = () => new Promise<void>(resolve => setImmediate(resolve));
function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function identity(stat: { dev: number; ino: number }): string { return `${stat.dev}:${stat.ino}`; }
export function defaultCodexRoots(): string[] {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return [path.resolve(path.basename(home) === 'sessions' ? home : path.join(home, 'sessions'))];
}

export class IndexCollector {
  private active?: Promise<void>;
  private stopped = false;
  readonly errors: string[] = [];
  private lastProgress = 0;
  onProgress?: () => void;
  onReparseProgress?: (result: ReparseResult,totalSources: number) => void;
  constructor(readonly store: InspectorStore, readonly roots = defaultCodexRoots(), private fingerprintKey?: string) {}
  setFingerprintKey(key: string): void { this.fingerprintKey = key; }
  stop(): void { this.stopped = true; }

  async scan(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.scanInternal().finally(() => { this.active = undefined; });
    return this.active;
  }
  private async scanInternal(): Promise<void> {
    this.errors.length = 0;
    for (const candidate of this.roots) {
      try {
        const stat = await fs.lstat(candidate);
        if (stat.isSymbolicLink() || !stat.isDirectory()) { this.errors.push('FORBIDDEN_SOURCE: root must be an explicit directory without a symlink.'); continue; }
        const root = await fs.realpath(candidate);
        await this.walk(root, root);
      } catch (error) {
        if (storageBlockReason(error) && ((error as { errcode?: unknown }).errcode !== undefined || (error as NodeJS.ErrnoException).code === 'ENOSPC')) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.errors.push(`SOURCE_UNAVAILABLE:${(error as NodeJS.ErrnoException).code ?? 'unknown'}`);
      }
    }
    if (!this.stopped) this.store.reconcileDirty();
    if (this.errors.length > 100) this.errors.splice(0, this.errors.length - 100);
  }

  private async authorizedPath(canonical: string): Promise<boolean> {
    for (const candidate of this.roots) {
      const stat = await fs.lstat(candidate).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
      const root = await fs.realpath(candidate).catch(() => null);
      if (root && within(root, canonical)) return true;
    }
    return false;
  }

  private async walk(directory: string, root: string): Promise<void> {
    if (!await this.authorizedPath(directory)) return;
    const handle = await fs.opendir(directory);
    for await (const item of handle) {
      if (this.stopped) return;
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await this.walk(file, root);
      else if (item.isFile() && item.name.endsWith('.jsonl')) {
        const changed = await this.indexFile(file, root);
        if (changed && this.onProgress && Date.now() - this.lastProgress > 750) { this.store.reconcileDirty(); this.lastProgress = Date.now(); this.onProgress(); await yieldTurn(); }
      }
    }
  }

  async indexFile(filename: string, rootValue: string): Promise<boolean> {
    const root = await fs.realpath(rootValue); const file = await fs.realpath(filename);
    if (!within(root, file) || (await fs.lstat(filename)).isSymbolicLink()) throw new Error('FORBIDDEN_SOURCE');
    const stat = await fs.stat(file);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new Error('UNSUPPORTED_SOURCE_SIZE');
    const sourceId = `source:${digest(`${this.store.workspaceId}:${this.store.machineId}:${file}`)}`;
    if (this.store.excluded(sourceId)) return false;
    let cursor = this.store.getSource(sourceId);
    if (cursor && cursor.fileIdentity === identity(stat) && cursor.fileBytes === stat.size && cursor.mtime === stat.mtimeMs && (cursor.offset >= stat.size || cursor.waitingForRecord)) return false;
    const handle = await fs.open(file, 'r');
    try {
      const prefixBytes = Math.min(cursor?.prefixBytes || 4096, stat.size);
      const prefix = Buffer.alloc(prefixBytes); await handle.read(prefix, 0, prefixBytes, 0);
      let replaced = !!cursor && (cursor.fileIdentity !== identity(stat) || stat.size < cursor.offset || (cursor.prefixBytes > 0 && digest(prefix.toString('base64')) !== cursor.prefixDigest));
      if (cursor && !replaced && cursor.checkpointBytes > 0) {
        const checkpoint = Buffer.alloc(cursor.checkpointBytes);
        const read = await handle.read(checkpoint, 0, checkpoint.length, cursor.checkpointStart);
        replaced = read.bytesRead !== checkpoint.length || digest(checkpoint.toString('base64')) !== cursor.checkpointDigest;
      }
      if (!cursor || replaced) {
        cursor = { id: sourceId, workspaceId: this.store.workspaceId, machineId: this.store.machineId, path: file, root, label: path.basename(file),
          generation: cursor ? cursor.generation + 1 : 0, offset: 0, line: 0, fileIdentity: identity(stat), prefixBytes: 0, prefixDigest: '',
          checkpointStart: 0, checkpointBytes: 0, checkpointDigest: '', discarding: false, waitingForRecord: false, fileBytes: stat.size, mtime: stat.mtimeMs, lastSeenAt: new Date().toISOString(),
          context: { ...EMPTY_CONTEXT }, capabilities: [], issues: replaced ? ['SOURCE_GENERATION_CHANGED'] : [] };
      }
      const initialOffset = cursor.offset;
      let readOffset = cursor.offset;
      let recordStart = cursor.offset;
      let pending = Buffer.alloc(0);
      let batch: PendingObservation[] = [];
      const flush = async () => {
        if (!cursor) return;
        const size = Math.min(256, cursor.offset);
        const checkpoint = Buffer.alloc(size);
        await handle.read(checkpoint, 0, size, cursor.offset - size);
        cursor.checkpointStart = cursor.offset - size; cursor.checkpointBytes = size; cursor.checkpointDigest = digest(checkpoint.toString('base64'));
        cursor.prefixBytes = Math.min(4096, cursor.offset);
        const savedPrefix = Buffer.alloc(cursor.prefixBytes); await handle.read(savedPrefix, 0, savedPrefix.length, 0);
        cursor.prefixDigest = digest(savedPrefix.toString('base64'));
        cursor.fileBytes = stat.size; cursor.mtime = stat.mtimeMs; cursor.lastSeenAt = new Date().toISOString();
        this.store.commit(cursor, batch); batch = [];
        await yieldTurn();
      };
      const add = (bytes: Buffer, start: number, end: number, errorKind?: string) => {
        if (!cursor) return;
        const id = `observation:${digest(`${sourceId}:${cursor.generation}:${start}:${end}`)}`;
        const evidenceRef = `evidence:${digest(id)}`;
        let normalized; let content;
        try {
          if (errorKind) throw new Error(errorKind);
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          const parsed = parseLossless(text);
          normalized = normalizeCodex(parsed, cursor.context, { workspaceId: this.store.workspaceId, machineId: this.store.machineId, sourceId, evidenceRef, fingerprintKey: this.fingerprintKey });
          content = captureContent(this.store, normalized, parsed);
          cursor.context = normalized.context;
        } catch (error) {
          const reason = errorKind ?? ((error as Error).message.startsWith('UNSUPPORTED_') ? (error as Error).message : 'MALFORMED_RECORD');
          normalized = { kind: `gap/${reason}`, sourceTimestamp: null, semanticSequence: null, schemaFingerprint: 'unparsed', supported: false,
            issues: [reason], context: { ...cursor.context }, measurements: [], metadata: {} };
          if (!cursor.issues.includes(reason)) cursor.issues.push(reason);
        }
        for (const reason of ['UNSUPPORTED_USAGE_FIELDS','UNSUPPORTED_TOOL_OUTPUT_PARTS','UNSUPPORTED_TOOL_OUTPUT_FORMAT']) if (normalized.issues.includes(reason) && !cursor.issues.includes(reason)) cursor.issues.push(reason);
        if (normalized.measurements.some(m => m.kind === 'response')) { if (!cursor.capabilities.includes('identified_response')) cursor.capabilities.push('identified_response'); }
        if (normalized.measurements.some(m => m.kind === 'thread_counter')) { if (!cursor.capabilities.includes('cumulative_interval')) cursor.capabilities.push('cumulative_interval'); }
        if (normalized.supported && !cursor.capabilities.includes(ADAPTER_VERSION)) cursor.capabilities.push(ADAPTER_VERSION);
        if (normalized.metadata.compaction && !cursor.capabilities.includes('compaction-lifecycle/1')) cursor.capabilities.push('compaction-lifecycle/1');
        batch.push({ id, evidenceRef, generation: cursor.generation, byteStart: start, byteEnd: end, line: cursor.line, recordDigest: digest(bytes.toString('base64')), normalized, content });
      };
      while (!this.stopped && readOffset < stat.size && readOffset - initialOffset < MAX_SCAN_BYTES) {
        if (!await this.authorizedPath(file)) break;
        const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, stat.size - readOffset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, readOffset);
        if (!bytesRead) break;
        readOffset += bytesRead;
        pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
        let newline;
        while ((newline = pending.indexOf(10)) !== -1) {
          const bytes = pending.subarray(0, newline); const end = recordStart + newline + 1;
          cursor.line++;
          if (cursor.discarding || bytes.length > MAX_RECORD_BYTES) add(Buffer.alloc(0), recordStart, end, 'OVERSIZED_RECORD');
          else if (bytes.length) add(bytes, recordStart, end);
          pending = Buffer.from(pending.subarray(newline + 1)); recordStart = end; cursor.offset = end; cursor.discarding = false;
          if (batch.length >= 100) await flush();
        }
        if (pending.length > MAX_RECORD_BYTES || cursor.discarding) {
          if (!cursor.discarding) add(Buffer.alloc(0), recordStart, readOffset, 'OVERSIZED_RECORD');
          cursor.discarding = true; cursor.offset = readOffset; recordStart = readOffset; pending = Buffer.alloc(0);
          await flush();
        }
      }
      // Partial bytes are deliberately not committed as a malformed record.
      cursor.waitingForRecord = readOffset === stat.size && pending.length > 0;
      await flush();
      return true;
    } finally { await handle.close(); }
  }

  async evidence(id: string): Promise<EvidenceView> {
    const pointer = this.store.evidencePointer(id);
    const result: EvidenceView = { id, state: 'unavailable', excerpt: null, truncated: false, captureScope: 'local_source_record', byteStart: '0', byteEnd: '0', redactionPolicyId: 'local-preview-v1' };
    if (!pointer) return result;
    const { cursor, row } = pointer; result.byteStart = String(row.byteStart); result.byteEnd = String(row.byteEnd);
    const policy = projectPolicy(this.store, row.normalized.context.projectId);
    const privacyStamp = privacyVersion(this.store);
    if (!policy.allowSourcePreview || policy.excluded) { result.state = 'policy_denied'; return result; }
    if (row.generation !== cursor.generation) { result.state = 'source_changed'; return result; }
    const canonical = await fs.realpath(cursor.path).catch(() => null);
    if (!canonical) { result.state = 'source_missing'; return result; }
    if (!await this.authorizedPath(canonical)) return result;
    if (!within(cursor.root, canonical) || (await fs.lstat(cursor.path)).isSymbolicLink()) return result;
    const stat = await fs.stat(canonical);
    if (identity(stat) !== cursor.fileIdentity) { result.state = 'source_changed'; return result; }
    const size = row.byteEnd - row.byteStart - 1;
    if (size < 0 || size > MAX_RECORD_BYTES || row.normalized.kind.startsWith('gap/')) return result;
    const handle = await fs.open(canonical, 'r');
    try {
      const bytes = Buffer.alloc(size); const read = await handle.read(bytes, 0, size, row.byteStart);
      if (read.bytesRead !== size || digest(bytes.toString('base64')) !== row.recordDigest) { result.state = 'source_changed'; return result; }
      if (privacyStamp !== privacyVersion(this.store)) { result.state = 'policy_denied'; return result; }
      const text = redactText(bytes.toString('utf8'));
      result.state = 'available'; result.excerpt = text.slice(0, 8192); result.truncated = text.length > 8192;
      return result;
    } finally { await handle.close(); }
  }

  async reparse(signal?: AbortSignal): Promise<ReparseResult> {
    if (this.active) await this.active;
    const result: ReparseResult = { revision: this.store.revision(), sourcesReparsed: 0, unavailable: [] };
    const sources = this.store.sources(); this.onReparseProgress?.(result,sources.length);
    for (const source of sources) {
      if (signal?.aborted) { result.cancelled = true; break; }
      if (this.stopped) break;
      const cursor = this.store.getSource(source.id)!;
      if (cursor.path.startsWith('remote:')) { result.unavailable.push({ sourceId: source.id, reason: 'REMOTE_METADATA_ONLY' }); this.onReparseProgress?.(result,sources.length); continue; }
      try { await this.reparseSource(cursor, signal); result.sourcesReparsed++; }
      catch (error) {
        if ((error as Error).message === 'REPARSE_CANCELLED') { result.cancelled = true; break; }
        result.unavailable.push({ sourceId: source.id, reason: /^[A-Z_]+$/.test((error as Error).message) ? (error as Error).message : 'SOURCE_UNAVAILABLE' });
      }
      this.onReparseProgress?.(result,sources.length); this.onProgress?.(); await yieldTurn();
    }
    result.revision = this.store.revision(); return result;
  }

  private async reparseSource(cursor: SourceCursor, signal?: AbortSignal): Promise<void> {
    const canonical = await fs.realpath(cursor.path);
    if (!await this.authorizedPath(canonical) || (await fs.lstat(cursor.path)).isSymbolicLink()) throw new Error('SOURCE_NOT_AUTHORIZED');
    const handle = await fs.open(canonical, 'r');
    this.store.db.exec('CREATE TEMP TABLE reparse_stage(id TEXT PRIMARY KEY,record TEXT NOT NULL);');
    try {
      const start = await handle.stat();
      if (identity(start) !== cursor.fileIdentity || start.size < cursor.offset) throw new Error('SOURCE_CHANGED_DURING_REPARSE');
      let context = { ...EMPTY_CONTEXT }; let count = 0;
      const retainedContext = !!cursor.retentionFloor || !!this.store.db.prepare('SELECT 1 FROM project_retention_floors WHERE workspace_id=? AND source_id=? LIMIT 1').get(this.store.workspaceId, cursor.id);
      const records = this.store.db.prepare('SELECT * FROM observations WHERE source_id=? AND workspace_id=? ORDER BY generation,byte_start');
      for (const raw of records.iterate(cursor.id, this.store.workspaceId)) {
        if (signal?.aborted) throw new Error('REPARSE_CANCELLED');
        const row: PendingObservation = { id: String(raw.id), evidenceRef: String(raw.evidence_ref), generation: Number(raw.generation), byteStart: Number(raw.byte_start), byteEnd: Number(raw.byte_end), line: Number(raw.line), recordDigest: String(raw.record_digest), normalized: JSON.parse(String(raw.normalized)) };
        if (row.generation !== cursor.generation) throw new Error('HISTORICAL_GENERATION_UNAVAILABLE');
        if (retainedContext) context = { ...row.normalized.context };
        if (!row.normalized.kind.startsWith('gap/')) {
          const size = row.byteEnd - row.byteStart - 1;
          if (size < 0 || size > MAX_RECORD_BYTES) throw new Error('INVALID_RECORD_POINTER');
          const bytes = Buffer.alloc(size); const read = await handle.read(bytes, 0, size, row.byteStart);
          if (read.bytesRead !== size || digest(bytes.toString('base64')) !== row.recordDigest) throw new Error('SOURCE_CHANGED_DURING_REPARSE');
          try {
            const previousProjectId = row.normalized.context.projectId;
            const parsed = parseLossless(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            row.normalized = normalizeCodex(parsed, context,
              { workspaceId: this.store.workspaceId, machineId: cursor.machineId, sourceId: cursor.id, evidenceRef: row.evidenceRef, fingerprintKey: this.fingerprintKey });
            if (previousProjectId && row.normalized.context.projectId && row.normalized.context.projectId !== previousProjectId) throw new Error('PROJECT_IDENTITY_CHANGED');
            if (previousProjectId && !row.normalized.context.projectId) { row.normalized.context.projectId = previousProjectId; for (const measurement of row.normalized.measurements) measurement.identity.projectId = previousProjectId; }
            row.content = captureContent(this.store, row.normalized, parsed);
          } catch (error) { if ((error as Error).message === 'PROJECT_IDENTITY_CHANGED') throw error; throw new Error('PARSER_REPARSE_FAILED'); }
          context = row.normalized.context;
        }
        this.store.db.prepare('INSERT INTO reparse_stage VALUES(?,?)').run(row.id, JSON.stringify(row));
        if (++count % 100 === 0) await yieldTurn();
      }
      const end = await handle.stat();
      if (identity(end) !== identity(start) || end.size !== start.size || end.mtimeMs !== start.mtimeMs) throw new Error('SOURCE_CHANGED_DURING_REPARSE');
      if (!await this.authorizedPath(canonical)) throw new Error('SOURCE_NOT_AUTHORIZED');
      if (signal?.aborted) throw new Error('REPARSE_CANCELLED');
      const staged = this.store.db.prepare('SELECT record FROM reparse_stage ORDER BY json_extract(record,\'$.generation\'),json_extract(record,\'$.byteStart\')');
      function* rows(): Iterable<PendingObservation> { for (const row of staged.iterate()) yield JSON.parse(String(row.record)) as PendingObservation; }
      this.store.publishAnalysis(cursor.id, rows());
    } finally { this.store.db.exec('DROP TABLE reparse_stage;'); await handle.close(); }
  }
}
