CREATE TABLE annotations(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, finding_id TEXT NOT NULL, choice TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL,operation TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE budgets(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE device_gaps(device_id TEXT NOT NULL REFERENCES devices(id), sequence_start TEXT NOT NULL, sequence_end TEXT NOT NULL, reason TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(device_id,sequence_start,sequence_end));
CREATE TABLE devices(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT, state TEXT NOT NULL,
        token_hash TEXT, pairing_hash TEXT, pairing_expires INTEGER, last_seen TEXT, ack TEXT NOT NULL DEFAULT '0');
CREATE TABLE dirty_scopes(scope_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
CREATE TABLE exclusions(source_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, reason TEXT NOT NULL);
CREATE TABLE ledger(id TEXT NOT NULL, revision INTEGER NOT NULL REFERENCES revisions(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        scope_id TEXT NOT NULL, thread_id TEXT, machine_id TEXT, source_id TEXT NOT NULL, sequence INTEGER NOT NULL, response_key TEXT,
        status TEXT NOT NULL CHECK(status IN ('selected','quarantined')), entry TEXT NOT NULL, PRIMARY KEY(id,revision));
CREATE TABLE ledger_links(entry_id TEXT NOT NULL, revision INTEGER NOT NULL, observation_id TEXT NOT NULL REFERENCES observations(id), relation TEXT NOT NULL,
        PRIMARY KEY(entry_id,revision,observation_id,relation), FOREIGN KEY(entry_id,revision) REFERENCES ledger(id,revision));
CREATE TABLE observation_analyses(observation_id TEXT NOT NULL REFERENCES observations(id), revision INTEGER NOT NULL REFERENCES revisions(id), normalized TEXT NOT NULL, PRIMARY KEY(observation_id,revision));
CREATE TABLE observations(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL, generation INTEGER NOT NULL,
        byte_start INTEGER NOT NULL, byte_end INTEGER NOT NULL, line INTEGER NOT NULL, sequence INTEGER NOT NULL, semantic_sequence TEXT,
        timestamp TEXT, kind TEXT NOT NULL, evidence_ref TEXT NOT NULL UNIQUE, record_digest TEXT NOT NULL, normalized TEXT NOT NULL, received_at TEXT,
        UNIQUE(source_id,generation,byte_start,byte_end), UNIQUE(workspace_id,id),
        FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id));
CREATE TABLE price_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,record TEXT NOT NULL);
CREATE TABLE revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, policy_version TEXT NOT NULL);
CREATE TABLE scope_state(scope_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), active_revision INTEGER NOT NULL REFERENCES revisions(id), UNIQUE(workspace_id,scope_id));
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE source_analysis(source_id TEXT PRIMARY KEY REFERENCES sources(id), revision INTEGER NOT NULL REFERENCES revisions(id));
CREATE TABLE source_roots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,path TEXT NOT NULL,label TEXT NOT NULL,enabled INTEGER NOT NULL);
CREATE TABLE source_tombstones(source_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,machine_id TEXT NOT NULL,client_source_id TEXT,deleted_at TEXT NOT NULL);
CREATE TABLE sources(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), machine_id TEXT NOT NULL, path TEXT NOT NULL,
        thread_id TEXT, parent_thread_id TEXT, context TEXT NOT NULL, cursor TEXT NOT NULL, UNIQUE(workspace_id,id));
CREATE TABLE sync_batches(device_id TEXT NOT NULL REFERENCES devices(id), batch_id TEXT NOT NULL, digest TEXT NOT NULL, sequence_start TEXT NOT NULL, sequence_end TEXT NOT NULL,
        received_at TEXT NOT NULL, PRIMARY KEY(device_id,batch_id));
CREATE TABLE task_contracts(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE tool_index(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), thread_id TEXT, call_id TEXT NOT NULL,
        name TEXT, started_at TEXT, completed_at TEXT, input_observation TEXT REFERENCES observations(id), output_observation TEXT REFERENCES observations(id),
        input_metadata TEXT, output_metadata TEXT, context TEXT NOT NULL, conflicted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE trials(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, contract_id TEXT NOT NULL REFERENCES task_contracts(id), digest TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE usage_observations(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, observation_id TEXT NOT NULL, scope_id TEXT NOT NULL,
        source_id TEXT NOT NULL, generation INTEGER NOT NULL, sequence INTEGER NOT NULL, semantic_sequence TEXT, timestamp TEXT,
        evidence_ref TEXT NOT NULL, kind TEXT NOT NULL, response_key TEXT, measurement TEXT NOT NULL,
        FOREIGN KEY(workspace_id,observation_id) REFERENCES observations(workspace_id,id));
CREATE TABLE workspaces(id TEXT PRIMARY KEY);
CREATE INDEX annotation_finding ON annotations(workspace_id,finding_id,id);
CREATE INDEX event_page ON observations(workspace_id,source_id,sequence,id);
CREATE INDEX ledger_page ON ledger(workspace_id,scope_id,revision,status,sequence,id);
CREATE INDEX tool_scope ON tool_index(workspace_id,source_id,thread_id,started_at);
CREATE INDEX usage_scope ON usage_observations(workspace_id,scope_id,kind,response_key,sequence);
PRAGMA user_version=4;
