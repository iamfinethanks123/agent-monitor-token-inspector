import type { DatabaseSync } from 'node:sqlite';
import { digest, type NormalizedObservation } from '../accounting/codex-observations';

export function indexTimeline(db: DatabaseSync, workspaceId: string, sourceId: string, machineId: string, observationId: string, generation: number, n: NormalizedObservation): void {
  const context = n.context; const measurement = n.measurements.find(item => item.kind === 'response') ?? n.measurements[0]; const model = measurement?.model;
  const thread = measurement?.identity.threadId ?? context.threadId;
  const provider = model?.providerRoute ?? context.providerRoute;
  const scope = measurement?.scopeId ?? `scope:${digest(JSON.stringify([workspaceId, machineId, provider, thread ?? sourceId]))}`;
  const requested = model?.requestedModel ?? context.requestedModel; const observed = model?.observedModel ?? null; const tier = model?.serviceTier ?? context.serviceTier;
  const metadata = n.metadata; const search = [thread, requested, observed, provider, tier, n.kind, metadata.toolName, metadata.callId, metadata.targetFingerprint, metadata.compaction?.adapter, metadata.status === 'error' || metadata.exitCode !== undefined && metadata.exitCode !== '0' ? 'timeline-error/1' : null, context.turnId, ...n.issues].filter(Boolean).join(' ').toLowerCase();
  db.prepare(`INSERT INTO timeline_events(observation_id,workspace_id,source_id,machine_id,scope_id,thread_id,parent_thread_id,project_id,requested_model,observed_model,provider,service_tier,kind,timestamp,tool_name,call_id,file_identity,turn_id,search_metadata,generation)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(observation_id) DO UPDATE SET scope_id=excluded.scope_id,thread_id=excluded.thread_id,parent_thread_id=excluded.parent_thread_id,project_id=excluded.project_id,requested_model=excluded.requested_model,observed_model=excluded.observed_model,provider=excluded.provider,service_tier=excluded.service_tier,kind=excluded.kind,timestamp=excluded.timestamp,tool_name=excluded.tool_name,call_id=excluded.call_id,file_identity=excluded.file_identity,turn_id=excluded.turn_id,search_metadata=excluded.search_metadata`).run(observationId, workspaceId, sourceId, machineId, scope, thread, context.parentThreadId, measurement?.identity.projectId ?? context.projectId,
      requested, observed, provider, tier, n.kind, n.sourceTimestamp, metadata.toolName ?? null, metadata.callId ?? null, metadata.targetFingerprint ?? null, context.turnId, search, generation);
}

export function createTimelineIndex(db: DatabaseSync): void {
  db.exec(`CREATE TABLE timeline_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,observation_id TEXT NOT NULL UNIQUE REFERENCES observations(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL,source_id TEXT NOT NULL,machine_id TEXT NOT NULL,scope_id TEXT NOT NULL,thread_id TEXT,parent_thread_id TEXT,project_id TEXT,requested_model TEXT,observed_model TEXT,provider TEXT,service_tier TEXT,kind TEXT NOT NULL,timestamp TEXT,tool_name TEXT,call_id TEXT,file_identity TEXT,turn_id TEXT,search_metadata TEXT NOT NULL,generation INTEGER NOT NULL);
    CREATE INDEX timeline_workspace_order ON timeline_events(workspace_id,sequence);
    CREATE INDEX timeline_source_order ON timeline_events(workspace_id,source_id,sequence);
    CREATE INDEX timeline_thread_order ON timeline_events(workspace_id,thread_id,sequence);
    CREATE INDEX timeline_kind_order ON timeline_events(workspace_id,kind,sequence);
    CREATE INDEX timeline_time_order ON timeline_events(workspace_id,timestamp,sequence);
    CREATE INDEX timeline_time_sort ON timeline_events(workspace_id,(timestamp IS NULL),timestamp,sequence);
    CREATE INDEX timeline_project_order ON timeline_events(workspace_id,project_id,sequence);
    CREATE INDEX timeline_tool_order ON timeline_events(workspace_id,tool_name,sequence);
    CREATE INDEX timeline_ledger_observation ON ledger_links(observation_id,revision);`);
  const rows = db.prepare(`SELECT o.id,o.workspace_id,o.source_id,o.generation,s.machine_id,COALESCE(a.normalized,o.normalized) AS normalized FROM observations o JOIN sources s ON s.id=o.source_id LEFT JOIN source_analysis r ON r.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision ORDER BY o.rowid`);
  for (const row of rows.iterate()) indexTimeline(db, String(row.workspace_id), String(row.source_id), String(row.machine_id), String(row.id), Number(row.generation), JSON.parse(String(row.normalized)) as NormalizedObservation);
}
