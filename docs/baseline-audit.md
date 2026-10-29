# Baseline and adapter audit

Audit date: 2026-10-12, macOS ARM64. This is an implementation baseline, not a claim that the full specification is implemented.

## Pinned software

- Agent Monitor: `donvito/agent-monitor`, commit `988a28fb9d5bb73597aaa80220a550eda05879dc`, version 0.1.0. No LICENSE/COPYING or package license field in the inspected checkout; redistribution permission is unresolved.
- Official arm64 archive: 128,621,339 bytes; SHA-256 `999a65583d6721a5a25aa7457d925cc61054aa572fe7b0ba61fbb31a157eb02a`. Installed bundle passes `codesign --verify --deep`.
- Existing Codex Usage integration: `de40c7a`, upstream `0878be25cdc2b6a46f78ce8513e5a60d3ef5939b`. Its Python v1 records do not retain missing-field presence or sufficient provenance for the new canonical ledger. Preserve them as legacy evidence; never silently treat them as response records.
- Mac observed Codex trace runtime: `0.162.0-alpha.2`. Ubuntu CLI version and Windows runtime remain unverified.

## Original verification

- `npm ci`: completed with the upstream lockfile; no dependency upgrades.
- `npm run typecheck`: passed.
- `npm run build`: passed, with the existing >500 kB renderer chunk warning.
- `node scripts/smoke.mjs`: passed the real Electron acceptance flow. Screenshot: temporary `agent-monitor-smoke.png`.
- `npm test`: 50 tests, 45 passed, 1 failed, 4 Windows-only skipped. Failure: truncation/rewrite segment of `tests/backend.test.ts`.
- Focused reproduction confirmed that after truncation macOS emits a raw `change`, but Chokidar emits no high-level change for the rewrite. Reuse the existing signature-checked operation queue for darwin raw events; do not increase test timeouts or replace assertions.

## Observed passive envelope mapping

Sampling read only explicit Codex session roots. The audit retains field names, runtime version and counts, not conversation bodies, account IDs or secrets. Three files contained 4,160 records, including 383 `token_usage_record` and 396 cumulative `event_msg/token_count` records. This is a sample and does not establish completeness of all requests or machines.

Adapter `codex-passive`, version 1:

- `session_meta.payload`: source thread/session identity, provider route, parent/fork identity and runtime version. Account identifiers and instructions are not indexed.
- `turn_context.payload`: requested model/reasoning configuration. A requested model is not an observed provider model.
- `token_usage_record.payload`: response/thread/session/turn/root-turn IDs; `usage` is the identified usage observation; `turn_token_usage` and `thread_token_usage` are controls and must not be added again.
- `event_msg.payload.type == token_count`: `info.total_token_usage` is a thread counter; `last_token_usage` without a validated response identity cannot prove a unique request.
- Recognized native token fields: input, cached input, cache-write input, output, reasoning output and total. Input includes cache subsets; output includes reasoning. Preserve original field presence and native total before validation.
- Top-level `ordinal` is available in the inspected rich records. Native integer lexemes must survive JSON parsing; timestamps may be missing.
- `response_item` call/result IDs provide lifecycle pairing within the thread namespace. Raw content is accessed locally by an authorized evidence pointer, not copied or synced implicitly.
- `compacted` is an explicit compaction event; a token-input decrease alone is not a compaction event.
- Unsupported envelopes are indexed as unsupported metadata. They cannot produce canonical usage simply because similarly named fields exist.

Supported tiers are fixture-dependent: aggregate/interval for legacy counters, identified response for the inspected rich envelope. Passive capture does not establish complete client/server context composition or exact tool-level billed cost.

## Runtime and privacy gaps

The v1 Python collector uses plaintext device tokens in private local configuration and component clamping. The replacement must use OS-protected credentials and metadata allowlists before it becomes the production collector. Existing service/tunnel/data stay intact until replacement reception is verified. Windows physical execution remains a user handoff.
