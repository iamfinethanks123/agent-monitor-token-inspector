# Cached original specification section 20

Recovered from this chat's original tool output at log line 1279, call `call_eBGpyrdmUekl7vjEAlvQxwZ9`. Not a fresh source read or an implementation/completion claim. Original source and pinned hash are recorded in `spec-cached-features.md`.

## 20. Validation plan and acceptance fixtures

All fixtures must be synthetic, or explicitly authorized and locally redacted. A fixture manifest records source semantics, expected totals, field presence, identities, and expected findings. Tests cannot use guessed upstream fields as proof of compatibility.

| Test | Scenario | Required result | Features |
|---|---|---|---|
| T01 | Supported old schema lacks response IDs | Interval/aggregate mode; no invented request count | F01-F02 |
| T02 | Rich response record plus matching thread total | Count responses once; total is a control | F02 |
| T03 | Import same file repeatedly | Canonical totals unchanged | F02, F10 |
| T04 | Two distinct responses have identical token counts | Both counted | F02 |
| T05 | Duplicate final observation for same response | One canonical entry; duplicate evidence retained | F02 |
| T06 | Same response ID has conflicting final counts | Conflict visible; no silent overwrite | F02, F18 |
| T07 | Cached/reasoning fields absent | Unknown, not zero | F02, F15 |
| T08 | Cached input exceeds input | Invalid semantic record flagged | F02, F18 |
| T09 | Reasoning exceeds output | Conflict flagged; no extra charge | F02, F15 |
| T10 | Cumulative 11k, 33k, 33k | 33k total; 22k increase; no 77k sum | F02 |
| T11 | First snapshot has no baseline | Prior/untimed bucket, not import-minute spike | F02, F10 |
| T12 | Counter falls without reset proof | Affected interval quarantined | F02, F18 |
| T13 | Confirmed correction or reset | Explicit revision/epoch policy; auditable totals | F02 |
| T14 | Interrupted request has no final usage | Unknown cost, not free request | F02 |
| T15 | Same events forwarded from another machine | Deduplicate only with valid origin evidence | F02, F14 |
| T16 | Fork contains copied historical events | Do not count copied execution again | F02, F08 |
| T17 | Child actually executes inherited context | Count new child response input | F02, F09 |
| T18 | Partial JSONL line across writes | Commit only completed record; no loss | F01, F10 |
| T19 | Rotation/truncation during collection | New source generation; no false accounting reset | F01-F02 |
| T20 | Oversized/malformed record | Bounded skip/gap; later valid records processed | F10, F18 |
| T21 | 10,000-event run and restart | First/last retained events accessible; totals stable | F10 |
| T22 | One file printed through a tool | One primary origin category, not two | F03-F04 |
| T23 | 1 MiB original output reduced to 2 KiB model payload | Estimate appropriate captured scope only | F03-F04 |
| T24 | Visible reconstruction exceeds official input | Discrepancy shown; no negative unknown bucket | F03 |
| T25 | Repeated path but changed/unknown content | No identical-content claim | F05 |
| T26 | Identical captured file range repeated | Evidence-backed candidate, savings unknown | F05 |
| T27 | Required post-edit/independent verification | Suppression or lower-confidence finding | F05, F08 |
| T28 | Same failed test with no observed progress | Candidate with alternatives and evidence | F06 |
| T29 | Test error changes after relevant fix | Separate productive debugging from stagnation | F06 |
| T30 | Poll a long-running process repeatedly | Not counted as repeated test execution | F06 |
| T31 | Explicit compaction without separate usage | Count event; overhead unknown | F07 |
| T32 | Input drop without compaction event | No confirmed compaction claim | F07 |
| T33 | Two intentionally independent reviewers | No automatic inefficiency penalty | F08-F09 |
| T34 | Agent says done; acceptance test fails | Verified failure/unverified completion as appropriate | F09 |
| T35 | Multiple findings reference same responses | Associated aggregate uses union | F11-F12 |
| T36 | Historical import triggers many matches | Findings created; no live-alert flood | F11 |
| T37 | Mixed models, unknown route, missing tier | Partial/unpriced states; no last-model pricing | F15 |
| T38 | Malicious HTML, CSV formula, prompt injection | Escaped/export-safe; no execution or exfiltration | F12, F16-F17 |
| T39 | External advisor disabled | Core diagnostics still work | F12 |
| T40 | Benchmark variant cheaper but fails | Not recommended as quality-preserving improvement | F13 |
| T41 | 24-hour disconnect then bounded replay | Durable progress; no duplicates; freshness correct | F14 |
| T42 | Revoked device / forged workspace ID | Ingestion and detail access denied | F14, F17 |
| T43 | Secret markers in local trace | Not present in metadata sync or AI payload | F14, F17 |
| T44 | User deletes monitor history; source still exists | Tombstone/exclusion works; source unchanged | F17 |
| T45 | Unsupported schema upgrade | Capability downgrade and visible warning | F01, F18 |
| T46 | Unsupported account method/auth | Graceful unavailable state | F19 |
| T47 | Context manifest linked to known response | Inclusion supported only for client-visible scope | F20 |
| T48 | Existing non-Codex upstream fixtures | No regression of preserved behavior | F01-F02, F10 |
| T49 | Token totals exceed JS safe-integer range | Exact string/bigint behavior; overflow rejected | F02, F16 |
| T50 | SQLite crash, storage-full, or interrupted migration | Previous data preserved; visible degraded state | F10, F18 |

### 20.1 Test levels

**Unit:** Parsing, identity, token arithmetic, category exclusivity, error signatures, fingerprints, redaction, and detector suppression.

**Property/invariant:** Replay idempotency; batching/order independence within supported semantics; no selected overlap; subset bounds; null preservation; union aggregation; source cursor durability.

**Integration:** Append/rotate/truncate files, restart workers, migrate DB, reparse revisions, import/export, offline sync, revocation, and deletion propagation.

**UI:** Keyboard navigation, provenance details, unknown states, source gaps, stale data, long timelines, and no confidential contents in notifications.

**Platform:** macOS ARM64 and Windows x64 desktop; Linux ARM64 headless collector; packaged native dependency compatibility; no assumption that an x64 artifact runs natively on ARM64.

**Security/performance:** Malicious fixtures, authorization boundaries, oversized inputs, resource targets, and original-log immutability.

### 20.2 Validation report contents

Each milestone report must include the code revision, fixtures, commands, actual outcomes, known failures, and deferred conditional capabilities. “Tests written” is not “tests executed.” “Source inspected” is not “Desktop compatibility demonstrated.”
