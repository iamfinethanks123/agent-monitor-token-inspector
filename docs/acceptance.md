# Integration validation — 2026-10-13

This is a progress record, not a declaration that all F01–F20 requirements are complete.
The source specification is `Agent_Monitor_Codex_Token_Inspector_Spec.md`, SHA-256
`afe34991f72da8cea0896ca2a0ec2538444f3374fd04e282437301e038bb6480`.

## Executed evidence

- Full `npm test`: 65 tests, 61 passed, 4 Windows-only tests skipped on macOS, no failures. Log: `/tmp/agent-monitor-final-unit.log`.
- `npm run build`: typecheck and renderer/main/worker/headless collector builds passed. The renderer bundle size warning remains; it is not a failed build.
- Original Electron acceptance flow passed after the keychain startup correction. It checks preserved run selection, graph relationships, trace streaming and completion behavior. Log: `/tmp/agent-monitor-integrated-smoke.log`. It does not prove every new inspector screen.
- Private arm64 packaging and ad-hoc signature verification passed. Public redistribution remains conditional on resolving the pinned upstream license status.
- Accounting fixtures cover response/control overlap, replay, equal but distinct responses, conflicting final observations, missing counts, subset validation, falling counters, exact integers, interrupted file writes, source generations, retained history, oversized records and storage commit failure.
- Transport fixtures cover actual HTTP enrollment/authentication, idempotent batches, changed-payload conflicts, forged workspace/device identity, secret exclusion, revoke, endpoint encryption policy and declared spool gaps. They do not prove a physical Windows run or a 24-hour live replay.
- Privacy fixtures cover monitor-only source deletion, reimport suppression, original-log immutability, active-stream receipt-time expiry and prevention of cumulative-history resurrection. Reparse fixtures verify a new immutable analysis revision and preservation of the last valid ledger when original bytes change.
- Diagnostics fixtures cover literal `functions.exec` commands without execution of trace code, timing-noise-resistant retry candidates, captured message categories and union membership across overlapping findings. Two findings each associated with 60 tokens produce a 72-token union, not 120 tokens. Causal savings remain unknown.
- Passive quota fixture preserves a source-defined 270-minute window, decimal percentages and missing reset/duration values. Credit/secret markers are absent from stored normalized metadata and the quota view. Account totals and reconciliation gaps remain unavailable.
- Price fixture verifies immutable reviewed cards, historical/current calculations and missing-cache unpriced states. Multiple context tiers and all ambiguous price-boundary cases are not established by that single fixture.

## Runtime evidence and limits

- Current local Codex CLI protocol generation: `0.162.0-alpha.17.2`. Generated bindings contain `account/rateLimits/read` and `account/usage/read`. That establishes interface availability only, not supported account authentication or a successful live read. Live account integration is disabled.
- Ubuntu system collector was updated to compiled SHA-256 `43f8a92c6f0d53d26b51f92d96b1b0257a6eae8774b49eeb4d601c74ace145c8`; the transferred file hash matches the local build. The unit was active after restart. Fresh receiver acknowledgments must be checked after the Mac receiver is running.
- The Mac relay LaunchAgent is installed and was observed running after the existing identity was loaded into the OS SSH agent. The private key was not copied into the monitor or a delivery package. The agent identity lasts for the current OS login session; availability after a new login remains an operational prerequisite, not a verified unattended boot claim.
- The Windows package contains eight allowlisted files, Node v24.21.0 x64 and no enrollment credentials. Latest ZIP SHA-256: `c203351a855fd2ce283ead29ffddd1f1c9d24e875e72cfba96ac4252907f7381`. Windows SSH/DPAPI execution remains the authorized user handoff.
- A real packaged startup stalled in an OS keychain call before creating the receiver. The correction isolates the monitor-owned key operation in a bounded helper. Missing key access degrades new equality fingerprints, not token accounting, and never enables plaintext fallback.
- The monitor database was approximately 1.5 GiB with 238,958 historical ledger rows and 47,832 observations before the latest migration. Historical revision storage needs improvement without discarding required accounting provenance. No performance-target compliance is claimed.
- Final real packaged overview was inspected through native accessibility: revision 309 was loaded, Index current was shown, MacBook and Ubuntu canonical cards were populated, and the total preceded the device cards/charts. The legacy Windows card explicitly showed no data. Current installed main/worker matched the build; no keychain helper process remained after its deadline. This verifies those screens/states only, not the remaining UI inventory or accounting coverage.

## Requirement audit still open

2026-10-13 further evidence: fifteen focused accounting/storage/privacy fixtures passed. A Node v24.21.0 rehearsal migrated a consistent real monitor-data copy: 255,928 historical entries preserved by semantic checksum, valid foreign keys, and 14,396 shared payloads. The indexed migration footprint was 710,787,072 bytes versus 1,709,215,744 bytes; accounting-policy reconciliation took 8,703 ms on that copy. A development Node v22.14.0 iterator produced invalid JS text despite SQLite `json_valid` confirming valid data; the bundled Node v24.21.0 read all rows successfully. Do not infer source corruption from that old runtime binding.

The revised Electron acceptance flow passed with embedded task-map controls, automatic actual-source selection, no primary-runtime demo entrance, live append/child relationships/run switching and trace tabs. Its data is synthetic test traces, not the user's real activity. Real native v4 UI inspection separately showed Pocket-Printworks-Swift in LIVE mode with six agents and five spawn relationships. New design/package installation and real-data native inspection remain the final step for this batch.

That installation step is now verified for the representative views: the private Mac package is updated, live storage migrated to schema 5 with no foreign-key issues, and native deep-blue/light task maps showed LIVE with six actual Pocket-Printworks-Swift agents and five relationships. The source/run control row and grouped single navigation replaced the upstream sidebar/theme duplication. Native overview used the selected run scope; no QUERY_TIMEOUT banner appeared in those inspected views. The full UI/accessibility/performance inventory and the remaining feature scope are still open.

- F01–F02: richer unsupported-version gates, supported corrections/resets, verified cross-observer origin mapping and fork-copy accounting still need completion and evidence (T13–T17, T45).
- F03–F10: occurrence facets and reconstruction discrepancies, normalized progress-aware retry signatures beyond timing noise, cross-agent overlap/review rules, compaction deduplication/proxies, complete timeline and tool paging need refinement (T23–T33).
- F11–F13: persistent incident revision/cooldown and scoped suppression, complete resource budgets, full task/trial protocol metadata and broader quality-preserving cohort decisions remain incomplete (T34–T36, T40).
- F14: encrypted queue/replay fault injection, enrollment persistence confirmation and client-side exclusion propagation are implemented and tested. Offline file export/import, explicit origin evidence and physical Windows execution remain outstanding; the 24-hour-aged fixture is simulated-time evidence (T15, T41–T44).
- F15–F17: complete price-tier evidence, findings/outcome/experiment exports, per-project retention/export rules and complete management auditing remain incomplete (T37–T44).
- F18: resource metering and historical-revision storage growth, schema/gap coverage details and migration/rollback evidence beyond initial fixtures remain incomplete (T45, T50).
- F19: passive quota is implemented; an approved, feature-detected live account connection and comparable aggregate reconciliation are not implemented (T46).
- F20: owned-client metadata manifests and controlled request/response fixture matching are implemented and tested (T47). Native import remains opt-in and was left disabled on the real workspace. Actual normal Desktop instrumentation is not claimed.
- Final UI: representative real packaged inspector screens, keyboard/focus handling, long history behavior, themes and scale checks remain to finish. A passed original graph acceptance flow is not completion of the new UI.


## Subsequent deployed context/map batch

Schema 6 adds immutable context manifests/results and exclusions without replacing
schema-5 accounting memberships. Live Mac migration retained a consistent prior
snapshot and reported zero foreign-key issues at revision 419. The native resource
view showed actual CPU/RSS/worker heap/database/WAL samples; those samples are not
proof of idle or scale targets.

The built owned-client hook persists ordered metadata before invoking an owned
transport; no normal Desktop requests are intercepted. Controlled tests establish
exact request/result matching, visible estimates, UTF-8 sizes, failure and missing
usage states, unchanged canonical totals, immutable replay/conflict behavior and
run deletion. No payload text was retained. A 215-call fixture establishes complete
tool paging. Scope changes and new event revisions invalidate tool cursors.

Twenty-four focused tests passed before the final scope refinement; eleven relevant
manifest/storage/diagnostics/privacy tests then passed after it. The updated Electron
acceptance passed after fixing NaN framing for hidden graphs and new-agent framing
cancellation during usage rerenders. Graph headers now use canonical usage, while
agent nodes retain source reports. Typecheck/build/diff check and private signature
verification passed. Installed main/worker/preload matched the build.

The Ubuntu service is active with compiled SHA-256
`509ba1e30f1c4a091affb6616a72bb9dca8b576eb2b9ad8dd90b5cf31cfcaef2`.
Windows package SHA-256 is
`9ac2f2862ea91267809343f73dbbc7b27fa6f71ec7a457e2c710eb17b8440fb9`,
eight allowlisted files, 35,008,228 bytes, no enrollment credentials. Windows execution
and practical long-disconnect replay remain unverified. Earlier package/hash and
"F20 not implemented" entries above are historical, superseded by this batch.


## Durable collector exclusions and confirmation

Schema 7 deployed successfully on the Mac (revision 501 checkpoint, no foreign-key
issues). Authenticated exclusion controls, durable client recovery, queue cleanup,
retained-source replay and acknowledgement receipts are now implemented. The hub
rejects reimport before a client reconnects. Pruning remains local/offline, and gap
metadata precedes file removal. Pairing confirmation follows reopening the saved
protected credential; re-enrollment preserves the old spool key or stops before
rotating the server credential. Management actions are audited without contents.

Eleven focused collector/transport/privacy/migration tests passed. Three synchronization
scenarios passed after the final bounded-response/offline-pruning refinement. They
exercise simulated 24-hour queue age, actual connection refusal, restart, lost ACK,
deferred deletion recovery, stable retained-source identity, forged receipts,
workspace mismatch, revocation and interrupted gap cleanup. No real user source was
deleted. These tests do not claim a physical 24-hour host outage.

Native Mac evidence showed Ubuntu active, its saved credential confirmed and new
usage acknowledged through sequence 4122. Ubuntu's deployed collector hash is
`83d47e4a861ffc470240040e1594fcf29a59642f93a66657cb287da229fc4f30`.
The current Windows ZIP is 35,010,353 bytes with SHA-256
`bb723dbd92b49f0c3ae3cb05de890534b507b665688d9cc340853aaadf690375`.
Its eight allowlisted files contain no enrollment credentials. Physical Windows
execution and offline file transfer remain unverified/unimplemented respectively.

## Imported experiments and complete reports

Optional frozen-input/protocol annotations, paired ordering, quality gates, immutable
whole-run resource snapshots and exact distributions are implemented. Every stored
attempt remains visible, including failures, setup failures, cancellations and
exclusions. These are imported observations and user-reviewed outcomes; an automated
benchmark runner and physical artifact freezing remain outside this evidence.

Markdown/JSON/CSV export includes outcomes, findings, advice, version/coverage and
evidence availability. Notes are omitted by default. Complete-population limits
reject oversized requests. The exact frozen preview is saved, with a separate
content-free export audit. Eight focused experiment/privacy tests passed, including
membership across more than 200 entries, immutable snapshots, foreign evidence,
ineligible cheap failures, unknown setup cost and CSV formula safety. The isolated
native acceptance app exercised preview, saved-byte equality and audit creation.

Real full-history validation exposed repeated ledger-page queries taking 56.3
seconds. One bounded report query replaced them. Read-only real data then rejected
oversized history in 2.1–6.8 seconds and generated a selected-run JSON report of
7,517,001 characters in 10.5 seconds. The report IPC deadline is 60 seconds; ordinary
queries remain 15 seconds. No general throughput or idle-resource target is claimed.

The final signed private Mac package is installed and matches current compiled
files. Native views showed the new experiment/report controls and real Mac/Ubuntu
totals; final Task map showed LIVE and the newest actual agent. The installed app
generated an actual task's Markdown preview at revision 719 with 23 complete
preview pages and a Save button, without report timeout. No real report was saved
automatically. Schema-7 foreign-key checking reported zero issues. Ubuntu collector
matches compiled SHA-256 `4ffe4e5d5002228677d70cc743b0fceebf825d6f8e12dc537db75abfa2ac92ba`,
with fresh receiver heartbeat and ACK 4220. Windows package SHA-256 is
`5be394b1522ca286db15ffed32e6bf1b95934956a5e03d6090b2fadf8c13216b`, eight
allowlisted files, no enrollment credentials. Windows physical execution remains
unverified. Schema remains 7; the complete F01–F20 objective remains open.

## Schema 8 incidents, resource budgets and time charts

The expanded objective now includes many dashboard charts from one minute to one
day. Twelve charts share a window, bucket size and temporal cursor. Exact bigint
bucket/group tests establish 1440-minute bins, minute/day switching, coverage and
subset handling, scope filters, untimed exclusion and interval/response separation.
The isolated native acceptance opens every chart and switches window/bucket sizes.
Actual schema-8 native views already showed real Mac/Ubuntu data, populated series
and no timeout; the final independent output/cache plots and synchronized cursor
passed native isolated acceptance before installation.

The final installed package was then reopened on the real workspace. All 12 chart
headings were present, and the native 1-minute-to-1-day bucket menu was inspected.
Selecting one minute produced 1440 real-data buckets without timeout. Every compiled
renderer/main/worker/client file matched its installed counterpart. The app was left
on Overview at one-minute resolution; this is representative UI evidence rather than
the complete accessibility/platform/scale audit.

Persistent incidents preserve source watermarks, record revisions, annotations,
controlled-alert counts and scoped suppressions. Historical/startup baselines,
warm-up, recent evidence and cooldown prevent retrospective floods and repeated
alerts after restart. Synthetic evidence establishes 100 failures in one record,
one initial alert, controlled updates, unknown baselines and source deletion.
Four budgets retain independent token, uncached-input, observed-span and currency
units. Neither timestamp spans nor API-equivalent prices imply runtime or billing.
Statistical cohort anomalies and independent remote transport-gap alerts remain
unimplemented; explicit compaction records are not yet independently deduplicated.

Thirty-four relevant tests passed after active-scope query ordering changed, plus
typecheck/build, isolated native acceptance and diff check. Final UI refinements
passed build/acceptance again. Real corpus profiling changed the 1440-bin query
from 10852 ms to 795 ms at revision 772 without changing known total 286941017.
There were 630053 historical memberships and 15527 active memberships at that
checkpoint. These observations do not prove the spec's full resource/scale targets.

Live Mac migration is schema 8 with zero foreign-key issues. The previous busy app
did not exit normally; a verified consistent schema-7 snapshot was preserved before
stopping only its process. The new bounded native Quit completed successfully.
Original apps/logs and enrollment credentials were preserved. Rolling back across
schema versions requires the matching preserved database snapshot.

Ubuntu collector is active with compiled SHA-256
`ea9bc9e2efdc66b6409cf0c986a8cea6b27888a74e21ab5223c4b0f20e90e583`,
fresh receiver heartbeat and ACK 4262. Windows ZIP SHA-256 is
`a4df3908b6c12c34d8b530705c3868b407fb766a6247ffb4a4b95b2f3f4d66e3`,
35,010,707 bytes, eight allowlisted files and no enrollment credentials. Physical
Windows and the full F01–F20/platform/UI/scale objective remain open.

## Offline files and user-defined USD scenarios

Schema 9 adds registered device signing keys, separate authenticated-contact versus
data-receipt timestamps and immutable manual USD rate snapshots. Offline statistics
reuse online batch bytes/IDs, allowlists and canonical observations. Preview has no
ingestion effects; confirmation revalidates signatures/enrollment/sequence. Revoked
or foreign devices and changed files are rejected. Interrupted durable batches can
resume without duplicates, source exclusions still apply, and received offline files
do not prove online collector status. Queue ACK/cleanup remains an authenticated
online operation. Signed files are metadata exports, not encrypted courier files.

The user-expanded USD requirement is implemented through uniform or component rates
per million tokens, exact decimal arithmetic, included cache/reasoning subsets and
unknown/unpriced coverage. The total trend and machine/model/project rankings can
show the same user-defined scenario. Snapshotted rates and ledger revisions accompany
reports; these values are not provider-verified prices or subscription charges.

Twenty-five relevant tests passed. Isolated native acceptance demonstrated signed
file preview/confirmation, unchanged accounting before confirmation, exact post-import
accounting, local-only collection without enrollment/credential use, configured USD
conversion and dollar chart switching. No synthetic pricing or data was entered in
the user's real workspace. Final response-state/timeout refinement passed build and
signature verification; it fixes a startup error banner that survived later success.

The private Mac package is installed, schema 9 with zero foreign-key issues. Ubuntu's
real OS-protected signing key was reopened and registered, its hardened service stayed
active, and the Mac received fresh contact/ACK 4350. Compiled collector SHA-256 is
`5f99a75f804d9448b3070d039fbb48c8cef7ed9002ade17c0297631e181d4430`.
Windows ZIP SHA-256 is `8f9e78d09a93a6d9f631b3b7d6eea21dfa53defdc106cd349b25f7a53a02486b`,
35,014,377 bytes, 11 allowlisted files, no credentials. These observations do not prove
Windows DPAPI execution, physical offline file movement, a 24-hour outage, the full
spec or full UI/platform/scale acceptance.

2026-10-13 currency-first refinement: 23 focused tests passed for the shared official
model catalog, cache partitions/bounds, response/interval context tiers, model
attribution, exact huge counts, USD breakdown/chart/report reconciliation and
unchanged token totals. Isolated native acceptance passed USD as primary display,
manual/automatic switching, synchronized chart units and restored Trace Details /
By model. The signed installed Mac app matched all 8 packaged files; real native
Overview displayed USD primary and device/daily costs, and real Trace Details
opened both model rows and original charts. Native 2-day option selection was not
verified. Full-spec acceptance remains incomplete.

2026-10-13 project privacy: Schema 10 adds per-project receipt retention, export/raw-preview permissions, observation-level deletion and replay/counter-gap suppression. 28 focused tests passed. Isolated native acceptance exercised permission changes during a save dialog without writing a file, blocked trace/report retrieval, and reopened child trace after permissions were restored. This covers monitor/hub data; client-local policy propagation and positive raw-content retention remain open. Full-spec acceptance is incomplete. See docs/project-privacy.md.

Project-retention context refinement: reproduced identity drift when expired headers were missing but usage was retained. Reparse now seeds each retained row from its verified stored context. Provider, model, project, response ID and scope remain unchanged. 29 relevant tests pass; this final refinement was checked with its regression and build, after the full isolated native flow had passed.

2026-10-13 timeline: Schema 11 persists metadata projections and monotonic ingestion order. Full retained metadata search, source/time keyset paging, captured ledger references, inclusive/exclusive agent scope and finding/evidence navigation are implemented with virtualized rows. 29 focused tests and isolated native acceptance passed; 10,000 retained events navigate first/last after restart. A real consistent copy (60,887 events) migrated in 19,075 ms; improved 200-row queries measured 226/96/294 ms for ingestion/model search/time order. These measurements do not establish p95. Raw text search and richer derived finding/gap swimlanes remain open. Worker readiness now gates query timers during migration.

Final timeline deployment: installed package matched all 8 files. Actual native metadata timeline loaded 61,223 retained events and 163 unknown times at snapshot 1441 without a query timeout. A live read-only model search measured 532 ms, slower than the rehearsal and not a p95 claim. Schema-10 backup mode 600 and zero missing historical payloads were verified. The user switched to Overview before the real native search submit; that interaction is unverified and their chosen view was preserved.
- 2026-10-14 unified-scope delivery: 21 focused tests and isolated native control flow passed. Signature and all 8 installed files matched; asar SHA256 62ed9d5a7433b2b57aaa89efbbda488c4c77b44996448964984a25edfc8db289. Real Overview loaded USD totals plus shared Provider/Tier/Agent/date controls, MacBook and Ubuntu cost cards, with no QUERY_TIMEOUT in the inspected tree. Real scope changes beyond the isolated fixture were not asserted. See docs/unified-scope.md and the latest STATE.md entry; full specification remains in progress.


2026-10-14 compaction analysis: 35 related tests, final build and complete isolated native acceptance passed. Item-ID lifecycle deduplication and explicitly labeled adjacent legacy alias inference prevent notification-count bursts; pre/post Input proxies use selected responses in the same source generation/scope and never modify accounting totals. Trial snapshots retain separate operation/legacy counts without rewriting old snapshots. Real read-only sample: 40 groups, 33 pre-input and 34 post-input observations, 307 ms after projection filtering, not p95. Actual installed Context panel showed 40 groups and real Input differences with unknown overhead; no query timeout was observed. Signature and all 8 files matched, asar SHA256 78053b2a6fd9eb66371a85121e55552ea217fca1363e57a689f861bfaafe5a92. Full specification and remote compaction lifecycle remain incomplete. See docs/compaction-analysis.md and latest STATE.md.


2026-10-14 cross-agent comparison: 27 related tests, final build and a genuine seeded isolated native workflow passed. Candidate bucketing avoids all-agent pair enumeration; copied/ambiguous Call IDs and conflicted invocations are excluded; purpose/intentional-review annotations do not change ledger totals and are removed with source evidence. Linked response unions avoid summing overlapping groups. JSON/Markdown/CSV include scoped metadata-only results under existing export guards. Real read-only sample returned 49 agents, 5184 invocations and zero eligible groups in 856 ms; no conclusion of no duplication or p95 is implied. Final signed installed asar SHA256 0b7d8722e62838a934808ec7b600b83dead409675b8db01bbc4c308636f63dfd matched all 8 files. Actual USD Overview loaded. Real comparison interactions remain unverified because CUA returned stale/inconsistent navigation state; isolated native positive-path interactions passed. Full goal remains active. See docs/agent-comparison.md and latest STATE.md.


2026-10-14 context attribution: 30 related tests, final build and genuine seeded isolated native flow passed. Passive source estimates, current canonical Input and owned-client reconstructions stay separate; facets do not double-count primary origin, nontext billing stays unknown, negative reconstruction is not rescaled and repeated inclusion requires distinct matched responses. V1 compatibility and privacy/export restrictions remain. Final actual read-only sample improved from 46667 ms full tool scans to 1237 ms indexed/projection lookup; not p95. Installed asar SHA256 1365ed35c4546cbbcb73e1afc351a260e3155d1059f5b3cea78ec5a85c385cca matched all 8 files and signature. Actual native Context loaded 934 occurrences and 6 categories with no query timeout; user capture stayed off. Full specification remains in progress. See docs/context-attribution.md and latest STATE.md.


2026-10-14 retry progress: 29 related tests, final build and genuine seeded isolated native cases passed. Linked polling does not produce new attempts; edits/signature changes reset comparable-failure streaks; renewed recurrence remains visible and observed command success suppresses advisory alerts without declaring task acceptance. Associated selected-response unions are non-additive diagnostics. Real read-only query improved from 90491 ms to 470 ms after active-revision join-order correction; not p95. Final installed asar SHA256 0aa91a026aa95a24b6e267d9146db73c05fba7f5aa3b0849dd4495ab2eaa4a6b matched all 8 files/signature. Actual Findings loaded one unknown-progress episode and 773 unlinked polls/waits with no query timeout. Fresh Desktop spec read stalled and was cleaned up; full-spec audit remains open. See docs/retry-progress.md and latest STATE.md.


2026-10-14 local acceptance benchmark: 21 related tests, final build and isolated native preview/approval/actual execution/manual review flow passed. Approved bytes are frozen; OS networking/output-write limits and documented Node guardrails were tested without claiming malicious-code isolation. All known executions remain in the population; reviewed task outcome and command exit are separate, model tokens unknown. Source/privacy cleanup and report hash omission are covered. Final installed asar SHA256 ab8b0be7c4456557a9df73edf318c099b34992470088f7f85af54b9dcc0b1216 matched all 8 files/signature. Actual native Outcomes showed the new entry and no local runs; no real user benchmark was executed. AI benchmark execution, raw artifact retention and full-spec proof remain open. See docs/local-benchmark.md and latest STATE.md.

2026-10-14 Timeline investigation layers: 23 related tests, final build and genuine seeded native category/chart/evidence navigation flow passed. Actual installed History loaded 70,730 retained records and current finding/compaction/retry/gap layers at source snapshot 2232, including explicit unknown-time and display-cap labels; no QUERY_TIMEOUT appeared in the inspected tree. Read-only marker query was 2586 ms, not p95. Signed installed asar SHA256 407c5b3226852aa0d2f2e29e3f513c69fd24e038606b7444d53bf5de43a036bd matched eight files. Current markers remain separate from immutable source paging and ledger totals. Raw text search and full-spec acceptance remain open. See docs/timeline-investigations.md and latest STATE.md.

2026-10-14 Agent search: build/typecheck/diff checks and one focused genuine native flow passed metadata matching, zero matches, real node selection with unchanged topology/totals, keyboard focus and run isolation. Actual installed latest LIVE map displayed 1/1 results, 0/1 for an impossible query, and correct Escape focus. Actual USD Overview loaded both enrolled device cost cards. Signed installed asar SHA256 e31a3ae652341db529f1136da2891268037f25e22f68ac313f85ad69b97ca5f5 matched eight files. The original placeholder is now connected without enabling raw-text capture/search. Full-spec and physical Windows acceptance remain open. See docs/agent-monitor-integration.md and latest STATE.md.

2026-10-14 ledger explanation: 22 related tests and final build/typecheck/diff passed. Genuine seeded native flow passed all 73 replay supports, unchanged canonical total, modal keyboard behavior, Timeline and blocked raw preview; its initial focus-loss bug was fixed and sticky controls were visually checked. Actual read-only sample query was 4 ms with one support/two historical memberships, not p95 or replay coverage. Signed installed asar SHA256 fdcc7c17ab26617862db90846984839ebb72a257cb13f3a3895f2a8067aa66d5 matched eight files. Metadata/paging/parser-version and privacy semantics are documented in ledger-explanations.md. This does not establish full F02 or specification completion; spec-status.md records the preserved full inventory and open gates.

Actual native follow-up: raising the observed window enabled Ledger navigation and the new explanation at snapshot 2303, with included state, one support/no control, 1/1 records and 20/313 historical memberships. Close-button navigation restored focus and returned to all-device USD Overview. No query timeout or raw preview was observed. CUA Escape did not close the real dialog; isolated keyboard flow remains separate evidence. See latest STATE.md for that computer-input limitation.

2026-10-14 local sample inspection: four focused tests and final build/typecheck/diff passed. Genuine native sampler flow used test-only chooser replies and proved capability/unsupported/clear/cancel states, no raw disclosure and no enrollment/ledger import of an independent high-usage sample. Actual read-only bounded current-chat source returned 512 lines, 56 response records and 51 unique tool pairs with explicit prefix limits; not full request or Token totals. Signed installed asar SHA256 be289fb1619b9d76b5369b2961be93bb5c068c0325562bed4777ac39fcb0889e matched eight files. Native source selection against real user inputs is recorded separately. Full F01/spec/platform acceptance stays open. See source-samples.md and latest STATE.md.

Actual native sample follow-up: Machines & sources showed the new heading/button and stated limits. The genuine OS JSONL chooser opened and its Cancel button returned to the page; no file was selected or result imported. Positive result data is covered by the isolated sampler flow and separate authorized source query. No query timeout was seen. The app is left on Machines & sources; all-device USD Overview had loaded before navigation.

2026-10-14 total explanation: ten related tests, build/typecheck/diff and genuine seeded native member/source pagination plus entry drill-down passed. Captured identity/revision/price/value guard, non-additive source roles, outside-range endpoints, stable append/reprice pages and privacy/reparse invalidation are covered. Actual consistent read-only snapshot query returned 19825 members/42683 measurements in 4423 ms, not p95. Signed installed asar SHA256 692a3d43100221676833b4233f277322b92eeecb6d43aec8296263eb7963417f matched eight files. Complete F02/spec acceptance is not inferred; provenance/reset/correction and other gates remain open in spec-status.md. See total-explanations.md and latest STATE.md.

Actual native total follow-up: Overview and total snapshot 2350 loaded, including 19852 members/42728 source measurements and first-page membership, without value/revision rejection or query timeout. Real source-tab switching was not verified; later fresh state showed the dialog closed on Overview. Positive complete source/member paging and entry navigation retain their isolated native evidence boundary. No live privacy/price/credentials were changed.

2026-10-14 model transitions: eleven related tests plus three final focused cases passed, as did build/typecheck/diff and genuine native lazy disclosure/three-kind attribution/entry/Timeline flow. Stream/generation isolation, ordinal ordering, unknown/quarantine barriers, ambiguous positions, scoped full counts/200 detail cap and unchanged ledger are covered. Actual read-only query returned nine attribution changes and zero observed-model changes in 1972 ms; not p95 or complete actual switching coverage. Signed installed asar SHA256 206bf2d96dbc6866bbd6e036bfd2ae6839a6dac41bbe14fe168b8a94226abeb2 matched eight files. Cached F15 requirements support the addition; fresh full-spec audit remains open. See model-transitions.md and latest STATE.md.

Actual native model follow-up: Overview's lazy disclosure loaded snapshot 2381 with 8352 eligible entries/nine attribution changes/zero observed-model changes/95 recording streams/11591 blocked positions/no ambiguous positions. Nine attribution detail rows appeared; no query timeout was observed. Real endpoint/Timeline/raw-preview actions were not exercised. The app remains on Overview with the analysis open; counts are live rather than a completion claim.

### 2026-10-14 — F18 centralized quality console / diagnostic export

Eight scoped quality/report/experiment tests and isolated native Electron flow passed. Actual read-only fixed SQLite snapshot quality query optimized from 7681 ms to 1876 ms; diagnostic preview 2199 ms, not a p95 claim. Source/record/ledger denominators and detail caps documented in data-quality.md. Final build/typecheck/diff check passed; no ledger schema/wire/accounting change.

Signed private Mac update installed, eight files matched current dist; app.asar SHA256 3b8f0e072e5c34e9a99852bd69b7fab2d750ee1d5dc06c6b977ce6ad91029f05. Rollback before-data-quality-20261014. Actual native Quality page at revision 2437 displayed 72636 retained envelopes, 504 unsupported/unparsed, 213 gaps, 171 semantic issues, 232564885 unparsed span bytes, 8400 selected/11680 quarantined canonical members, zero additional response supports, 84 sources/76 schemas; no QUERY_TIMEOUT in inspected tree. These figures are time-specific. Physical Windows and wider gates remain unproven.

Actual installed diagnostic preview also completed at captured revision 2438 (four Markdown preview pages; exact-preview save action enabled), with no timeout/report-size error. The actual report was not saved or shared. Native source detail contents were only exercised in the isolated fixture; actual app validation established the scoped aggregate/read model and preview path.

### 2026-10-14 — No-change scans and actual USD status

Reproduced and fixed false collector progress on unchanged sources; three progress regressions plus eleven existing accounting tests passed. Final build/typecheck and isolated native IPC/UI passed: no data-change event across multiple idle scan cycles, stable revision/12 tokens, then append triggered visible 24-token update. Settings uses actual current-scope USD mode and counts. This is not a real active-workload CPU/p95 claim.

Private signed Mac update installed, eight packaged files matched dist; asar SHA256 27d918ffde74bca8789db9fdec8593c675575fb48e8713cd98324c3a1ca30b65; rollback before-collector-progress-20261014. Actual native Overview revision 2464 and Settings showed automatic pricing, 8289 priced/142 unpriced, no QUERY_TIMEOUT in inspected tree. User confirmed Windows package remains unrun/manual. Original cached T01–T50 and completion section were recovered for auditing; no claim that all gates passed.

### 2026-10-14 — Bounded advice / exact-copy privacy boundary

Pre-feature full integration: 162 cases, 158 pass/4 Windows-only skip/0 fail. Eleven related advice/diagnostics/report/experiment checks passed, then three focused advice checks after wording repair. Final build/typecheck/diff passed. Isolated native bounded plan/full frozen preview/exact-copy/audit/privacy-revoked-copy denial/unchanged 36 tokens passed; clipboard was stubbed only in the isolated app and user's system clipboard was not read or modified. Actual Findings loaded 22 plans and a collector-gap plan expanded after manual Mac unlock. Earlier no-timeout snapshots were later contradicted by actual devices/incidents QUERY_TIMEOUT; actual preview completion is not claimed from those attempts.

Index progress and scan-finish notifications now coalesce for ten seconds, with immediate first-scan completion and stop cleanup. Source commits, direct receiver/control/privacy notifications and query timeouts unchanged. Final idle/append/pricing native flow passed. Final signed private build installed; eight files matched; asar SHA256 4b3e47857aa47c12e9d0cde3111243084e3bb0c845d67d98c514ff9da43148a6. Rollback before-advice-source-updates-20261014 (prior plan build) and before-advice-plans-20261014 (prior feature). Complete active-workload recovery/full specification gates remain unproven pending native evidence. See advice-plans.md.

Final coalesced native snapshot exposed 22 real plan disclosures without a timeout at that instant, but native input/scroll later had noWindowsAvailable while exact installed PID stayed live. Actual native preview/copy/save completion and sustained timeout resolution are not claimed. Separate read-only fixed real DB snapshot revision 2582 produced 22 candidate plans and a 3195-byte Markdown plan with rollback/unknown savings: 6330 ms analysis, 9985 ms report. This is backend evidence only, not p95; query/queue performance remains open.

### 2026-10-14 — Indexed scoped diagnostics and report reuse

Reproduced wrong candidate association: observed model-a ledger 36 tokens, candidate 342 with model-b; corrected same filter/source generation logic keeps 36 while canonical all-model total 342. Current Timeline kind indexes honor reparse without raw observation rewrite. Fixed-scope four-query cache uses external/own SQLite mutation stamps, detached clones and proactive privacy clear; rolling days always recompute. Report policy uses retained indexed project metadata with existing source/mixed-source scope.

33 related checks, build/typecheck/diff and isolated native advice/privacy-copy flow passed. Earlier one historical-alert assertion failed once, then isolated and suite recheck passed; root cause unproven, no claim fixed. Fixed real read-only snapshot revision 2652: project populations identical, 2820 ms legacy vs 890 ms indexed; analysis 4276 ms/repeat 1 ms/report 1081 ms; equal diagnostic bodies, 22 findings. Not p95 or sustained native recovery.

Signed private update installed/eight packaged files match; asar e49d24d6d712646bea091d799a1fb0e26f5026a7e74b94ab56371785fbc3c7f8; rollback before-diagnostics-query-20261014. Initial CUA cgWindowNotFound is observation-only; real native acceptance pending at this checkpoint. See diagnostics-performance.md.

Actual installed process stayed live through an initial CUA cgWindowNotFound; same-path rebind succeeded without restart. Native Overview 2672/2673 and Findings 2675 loaded (22 bounded plans, expanded collector-gap rollback/preview control) without QUERY_TIMEOUT in those snapshots. Existing Token display preference preserved. Native preview activation/copy/save and sustained active-load recovery remain unproven; isolated exact-copy flow/backend timing are separate evidence.

### 2026-10-14 — Candidate-first four-section investigation page

Default candidate page now shows evidence/validation first. Retry, agent comparison and incidents retain original controls/callbacks and mount only when selected. Build/typecheck/diff passed; isolated native flow covered all four sections/mount removal/selection, return to candidates, frozen plan exact-copy/audit/privacy denial and unchanged 36 tokens. Final candidate top screenshot was visually inspected; no style unit tests added.

Signed private update installed/eight packaged files matched; asar bba7e771b61a742f729daf4eb9007f6f67fdd714094d28bb2e3a427fdcfeb116; rollback before-findings-workspace-20261014. Actual AX revision 2706 shows four controls/22 candidates/no timeout, but screenshot (including paired capture) still shows Overview 2705. Do not call real native visual/preview verification complete. Exact process remained live; no restart solely for observation failure, no unrelated Electron stopped. User physical-screen confirmation requested and pending. See findings-workspace.md.

### 2026-10-14 — Unsupported nonempty usage schema

Reproduced known outer/no known native fields incorrectly supported/source current. Added closed UNSUPPORTED_USAGE_FIELDS and unknown field-shape fingerprints; wholly unrecognized usage becomes unsupported, known partial/mixed controls preserved, absent/null/empty usage remains unmeasured, later valid responses continue. Source/sample/quality show partial limitation and localized explanation. No guessing/zero inflation or automatic real reparse, schema/wire/accounting changes.

21 related checks plus three final schema cases, build/typecheck/diff/syntax passed. Isolated quality UI 8 records/1 gap/2 semantic issues kept 24 tokens; sample chooser/ready/clear/cancel/unknown and renamed-only warning kept 12-token ledger/no outside sample import. Initial new sample fixture targeted the previous chooser file; binding repaired and complete sample flow rerun passed.

Signed private install/eight files match, asar 036e958737e584f4c41ad436d7bbce8ee01a292b1895c56b3e43019be36efd31; rollback before-usage-schema-20261014. Actual user source reparse/sample and remote health/old client deployment unperformed; prior AX/screenshot visual contradiction pending human confirmation. See usage-schema-guard.md.

### 2026-10-14 — Collector health and current native navigation

F14/F18 optional authenticated collector-health/1 is installed on Mac and deployed to the existing Ubuntu Collector service. Twelve health/transport/Project privacy checks and isolated native Devices/Quality flow passed, including missing/older distinction, client provenance, unchanged 12-token fixture ledger and sequence ACK. Sender summaries expose only fixed aggregate fields. Project policy changes clear snapshots; pending deletion or custom Project retention/exclusion suspends acceptance. Base heartbeat now records authenticated online contact even without a new batch.

Actual native Devices screenshot after deployment shows Ubuntu 14 sources / 24,564 retained records, 2 partial sources, 0 discovery errors, 74 unsupported, 4 gaps, 16 semantic issue records and 4,315,154 unparsed bytes; central receipt 2026-10-14 13:41:19 Hong Kong. Gaps are included in unsupported counts. Last successful receipt is sender-local ingestion, not latest model execution. No assumption of complete request coverage.

Mac signed private installation matches all eight build files, asar cafda414e0ecf8942a55d9460a5008cd0abc56acb67db1a99181cf3d22159f19. Rollback before-collector-health-20261014. Ubuntu service active, compiled hash 0dd167f7eff2a9f9d87ded831df2dead005db4ac40603ebaa047f8f40859799a, previous binary preserved. Credentials/service security settings unchanged. Windows ZIP updated with verified manifest/11 members/hash 2b1b6d3035978ef50c81ff56c182f84fc054fe7daf80f6189748c8e16cef052f; manual startup only, no physical Windows run.

User later answered physical screen was still Overview. Contemporaneous verification before this install then clicked Findings and paired AX/screenshot both showed the new page; a subsequent paired capture showed 22 real candidates and actual first candidate contents. This verifies current navigation and content, not a proven root cause for the earlier mismatch. No unrelated Electron process stopped. Full spec/platform/scale gates remain separate. See collector-health.md.

Updated installed build native follow-up: Findings revision 2792 displays 22 real candidates. First candidate plan expanded; `建立方案預覽` generated visible frozen Markdown preview for that finding/revision/scope, with observations, alternatives, bounded change, acceptance and rollback. AX and screenshot agree. No report saved/copied, no task or reparse executed. App left on the real preview.

### 2026-10-14 — Tool activity ranking and metadata reports

Full scoped Tool activity query/IPC and Context page ranking implemented. Grouped recorded name/operation; captured bytes/approximate payload estimates, repeated captured copies, failure/unpaired/conflicted/partial/unknown coverage and summed observed duration are separate from canonical charging. Groups capped20/evidence5 with uncapped scoped totals. No assumption of cross-source unique execution, subsequent request input, cache, causal cost or savings. JSON/Markdown/CSV frozen report branch preserves Project export privacy; CSV formula protection, ledger revision and observation watermark explicit.

17 relevant tool/diagnostic/context/Project policy tests passed; build/typecheck/diff/syntax passed. Isolated native flow covered207 calls/208 identities vs200-row paging, truncated/repeated output, source evidence, JSON/CSV preview, pause append207/resume208 and unchanged12-token fixture ledger. Existing Data quality native export regression also passed. Tool ranking screenshot visually inspected. Initial test used nonexistent query keys; fixture corrected to the established query contract.

Signed private Mac install matches all eight build files, asar26c0d1bb6446ce3988246f4b6fc53f64d4c192a0fedc912f58b26366648e96c1; rollback before-tool-activity-20261014. Exact current installed PID92872, oldPID76099 revalidated/gracefully stopped. Headless collector hash unchanged0dd167f7eff2a9f9d87ded831df2dead005db4ac40603ebaa047f8f40859799a; no new remote/client rollout.

Actual native ranking at revision2835 showed6,243 invocation items/16 groups,33,925 measured bytes,8,559 estimated tokens,885 repeated bytes; only334/6,163 outputs measured, so no complete payload coverage claim. Later data continued updating. Startup inspector:summary QUERY_TIMEOUT occurred and recovered without another restart; resource/startup gate not claimed fixed. Real tool report generated at frozen ledger revision2842 / observation watermark77120, confirmed in AX with estimator/adapter/policy and current preview visible partly in screenshot. Full report visual inspection was limited by intermittent CUA noWindowsAvailable; exact process remained live, one same-path rebind succeeded, no restart solely for observation failure. No save/copy/annotation/project policy/source log/task mutation. Full goal remains active; all prior spec/platform/scale/conditional requirements retained. See tool-activity.md.

### 2026-10-14 — Structured tool outputs and retained reparse progress

Confirmed local missing output measurements through readonly source shape inspection:24 recent indexed pointers all had typed output arrays; new parser measured24/24,150,345 text bytes and2 image parts, without original/database mutation. Added string-compatible typed text/media parsing, boundary-aware keyed parts identity, truncation/unknown downgrade and conservative unique process/exit evidence.20 relevant tests,7 follow-up process tests, build/typecheck/diff/syntax and isolated native legacy-to-new reparse/report flow passed; fixture46 text bytes/14 estimates/4 images kept12 canonical tokens and identical original bytes. Initial native assertion assumed whitespace between separate number/unit elements; changed the assertion to the actual number element and reran.

Parser private Mac install matched8 files, asar870ca6972884e31c68072f4e782aa621238d364f79eb6ee4a7f65a7652c5c851; rollback before-tool-output-parts-20261014. Ubuntu existing encrypted-credential service redeployed/active with collector045b1158eb9001c58156c07f3a6f9a4f85266e3e2dcb9de5f5d94dfb03626440; long-term credentials unchanged. Windows manual ZIP7f139eac52ab3d88dab9bed26b06334ff34ffa0a8b02b96cbac47f745b3a17ff/11 manifest-verified members, still unrun per user.

User confirmed manually pressing reparse. Source audit since07:00UTC records114 publications across78 distinct sources; final publication07:34:04UTC. Later normal local scan receipts08:18:41UTC prove the old reparse promise is no longer blocking scan. Retained tool text measurement rose from334 to5,700+ outputs. Do not infer a full completed/source-unavailable result for each operation from audits:36 sources were published before an observed PID change, and the older UI did not retain the full operation result across navigation/timeouts. PID14910 then19361 then40912 were observed; cause not established. CUA bindings were refreshed, no restart solely for capture expiry. Short CPU sample was inconclusive for exact timeout root cause.

Added durable metadata-only reparse operation counts and timestamps, restart-as-interrupted recovery, dedicated main-process cached progress, global indicator and retained settings result. Progress/receiver changes during reparse no longer cause whole-workspace rereads; terminal refresh remains.9 related tests and native operation workflow passed: real2-source fixture1 published/1 unavailable, no interim data-change notifications, results survive navigation/restart,24-token ledger preserved. Completed state requires the full attempted population; read timeouts do not mark jobs terminated.

After normal scanning resumed and the previous job had ended, installed the tracker private update. First installer aborted because PID19361 had changed; no binary replacement was claimed. Revalidated exact sole installed PID40912 and existing backup hash, stopped gracefully and installed. All8 files match current build; asar21ef5e27122803ccad94db607fb20d503fcdfcb2f1854210e2a7466146086291; rollback before-reparse-progress-20261014. New App opened; default USD/read view initial load observed. No real heavy reparse restarted to test tracking. Headless deployed045b parser remains valid; newer desktop-only optional progress callback is not used by those collectors. Full spec/platform/resource gates remain active. See tool-output-parts.md/reparse-progress.md.

### 2026-10-14 — Startup reads and query deadlines

Direct active membership/payload reads preserve revision, canonical filters and USD definitions. No-expiry retention skips global purge helpers and reconciles only expired affected scopes. Initial scan precedes worker ready; detailed charts mount after the main workspace bundle.24 related checks/build/native idle-append-pricing passed. First installed asar8ef0c0192fce1a1f4b107dd9be3e6690c17a3a03330b820b6c4805a330d7d52e matched8 files, rollback before-dashboard-startup-20261014. Actual revision3226 loaded Overview and charts, $1,025.73 API-equivalent/2,137,769,051 tokens/9247 priced/142 unpriced, Mac and Ubuntu populated, Windows not received. Settings then showed prices/privacy/experiments QUERY_TIMEOUT; no sustained-load success claim.

Added worker started acknowledgement and bounded60-second queue deadline, separate from unchanged15/60/600-second execution deadlines. Duplicate started does not reset time; late responses ignored; failure rejects pending work.3 regression cases load actual InspectorService with deterministic worker/clock boundaries; reproduced failing before fix, passed after. Initial VM harness export binding was corrected before the real red run. Build/typecheck/diff and native idle-append-pricing passed. Signed private update installed after exact solePID99167 revalidation/graceful stop; rollback before-query-deadline-20261014;8 files match, asar41713983a83e04659161ab5dd7d3ba7ba2448bce29e353559ad13a65bd60e8d7. Actual new native verification pending at this entry. No real reparse restarted, credentials/privacy/account/price/source logs changed, subagent, paid request, commit/push/public release. Full goal/platform/resource gates retained.

Final private update native Settings AX and screenshot agree: Index current, automatic model pricing,9,269 priced/142 unpriced, current USD view $1,026.14931 at its own ledger revision3237. Prices/privacy/experiments sections loaded; QUERY_TIMEOUT/QUERY_QUEUE_TIMEOUT/INDEX_STARTUP_TIMEOUT absent in inspected snapshots. Reparse entry present; older operation has no durable result record, no reparse restarted. This verifies the current navigation/load, not sustained-load p95 or all platform gates. CUA deadlineApp.

### 2026-10-14 — Recorded tool argument analysis

F04/F16 adds UTF-8 byte measurement and separately labeled approx-utf8-bytes-div4/1 estimate for recorded function/custom tool argument strings. Empty is observed0; missing/object/legacy unknown; conflicted calls excluded; exact bigint sums. No raw arguments or per-tool official usage/USD allocation; canonical ledger and metadata-only wire unchanged. Tool detail query, full-scope totals/group rows, six measure cards and frozen JSON/MD/CSV reports share fields.

10 related tool/parts/context tests passed, build/typecheck/diff passed. Native existing tool flow extended:207 calls/208 identities,7400 argument bytes/1851 estimates,419853 output bytes; source details, JSON/CSV preview, pause/resume and12-token accounting passed. Screenshot /tmp/agent-monitor-tool-activity-smoke.png visually inspected. Test simulated legacy missing fields and reparse, original source bytes unchanged. No real heavy reparse or credential/privacy/account/price/clipboard/task action; no new remote rollout because wire omits tool metadata. Full goal/gates retained.

Tool argument private update installed after revalidating exact solePID5477 and no running retained reparse, graceful shutdown, rollbackbefore-tool-arguments-20261014.8build files matched; asar445af6fec1223b4752e9db2766da00a598a2da2828ea6ae531eb9926d092e623; actualnewPID12743 live. Initial CUA cgWindowNotFound followed by live-process revalidation and same-path rebind (no restart); second CUA explicitly reports Mac locked. Asked user to manually unlock; current native actual-tool view pending, isolated native accepted.

Original full spec now readable:128468bytes/SHAafe34991f72da8cea0896ca2a0ec2538444f3374fd04e282437301e038bb6480 matches priorpin, copied verbatimto docs/spec-reference.md. Source read timeout is superseded; sections18–19 numeric targets/milestone gates inspected. Explicit reindex cancellation missing in current API/UI, marked actionable. Full goal active; optional modes/windowsmanual boundaries unchanged.

### 2026-10-14 — Reparse cancellation

Section18.2: AbortSignal at verification checkpoints, discarded unfinished per-source temp stage, retained already-published analyses and previous valid unfinished read models. Cancelled is distinct terminal metadata state, never unavailable/failure/completed; cached progress, resume scanning and rerun preserved. Sender-validated cancellation requires exact operation UUID; wrong/stale operation denied. UI running Cancel/disabled Cancelling and retained cancelled result/header, policy work locks preserved.

9 relevant cancellation/progress/privacy cases passed; final3 cancellation cases reran after correcting only TypeScript overload forwarding in test wrapper. Final build/typecheck/diff passed. Existing native reparse fixture extended:20,000 event source, UI cancel, wrong operation ID denied, incomplete population persisted/restarted as cancelled, rerun completes, original bytes and24canonical tokens preserved. Completed/unavailable/interrupted/notification behavior retained. Screenshot /tmp/agent-monitor-reparse-cancel-smoke.png visually inspected (final rerun completion). No actual history job started/cancelled, user settings/source logs/credentials/price/account/clipboard/benchmark changed; no headless redeploy, subagent, commit/push/public release. Full goal retained.

Final cancellation private install verified:8 files match current dist; asar4285cf94e9389985f372a4f77c5eaac090ca74eb9c2a84eb612d58848da936f7; rollbackbefore-reparse-cancel-20261014. New actualPID21350 live. First CUA cgWindowNotFound did not trigger restart; same-path rebind after process verification reports Mac locked. Existing user-unlock question remains pending; no duplicate prompt and no real reparse/cancel initiated. Actual native interaction remains pending, separate from successful isolated UI cancellation flow. Full goal remains active; continuing specification audit must not collapse this into all-platform/resource completion.

### 2026-10-14 — Generation-scoped tool identity

Two actual collector fixture reproductions failed before fix: reused Call ID across file replacement merged2operations into1; earlier input paired to later generation output-only event. New codex-tool/2 identity binds workspace/Codexsource/generation/thread/call. Tool detail, Context partition/seen set, Retry and comparison generation keys and initial3tool-detector stream boundaries updated; detector version2 prevents reusing old feedback on corrected identities. Older annotations retained. Tool cursors explicitly identity2; semantic analysis epoch invalidated on rebuild.

Transactional existing-tool read model rebuild uses immutable observations/current active analysis, never original files. Failed rebuild rollback/connection cleanup and reopened idempotency verified, including originals removed/current analysis differs from legacy normalized record; ledger/revision/observations/digests unchanged. No storage schema/wire/price change. CSV tool reports add adapter/policy/estimator/identity versions; JSON/MD identity recorded.25 related checks passed, final8identity/report tests passed, final build/typecheck/diff passed.

First native backend rotation result209 calls/0conflicts/419860outputbytes/209Contextoccurrences/12canonical tokens passed, but last visible panel stayed208 within5sec because manual refresh also used10sec background coalescing. Fixed explicit refresh to notify immediately and clear pending indexing timer, without changing idle scan behavior or execution timeouts. Final same native ranking/evidence/JSON/CSV/pause-resume/rotation workflow passed; separate native idle/append/pricing passed (0idle notifications;12->24). No timeout increase. No actual reparse/cancel, credential/privacy/account/price/source-log mutation, subagent, real task, commit/push/public release. Full goal remains active.

Actual private install tool identity:8files match asar176c6058db2bdd281396127b9b3df7726f196f56945f9b085ade912cf8f23afb; rollbackbefore-tool-identity-20261014. NewPID30498 live. First CUA timed out; same-path rebind succeeded without restart and showed actual INDEX_STARTUP_TIMEOUT. Readonly metadata proved real projection identity2/6861tool records/0legacyIDs committed; native visible totals still unready.

Identified startup recovery bug: original ready promise stays rejected after120second wait, so late successful first scan cannot recover later queries. Added initialized/terminal-error state; late-ready permits fresh reads and emits existing refresh notification, while120second startup and execution deadlines stay unchanged.4actual-service deterministic deadline cases passed including late-ready recovery and terminal worker rejection; build completed. Final package/install/native verification in progress. User explicitly reports manual unlock, continuing same actual app workflow; no heavy user reparse/cancel.

Actual recovery build65092fbf07b59d700b78e93c5612f2073445efe239a551199ed144e712be9a92 matched8 files; exact30498/no active user-reparse/graceful update, rollbackbefore-startup-recovery-20261014. NewPID35829 live. CUA timeout rebind without restart succeeded after user unlock, but showed first scan still unready/INDEX_STARTUP_TIMEOUT. Late-ready recovery remains proven by4service cases, not by completed real scan at that snapshot.

Changed worker bootstrap back to serving retained read models after root/accounting setup while first scan runs in background; last-valid metadata visible with indexing status, independent queue/execution timers protect reads. This supersedes earlier await-first-scan readiness strategy. Final build/typecheck/diff and native idle/append/pricing passed. New package pending; no actual reparse/cancel or raw/credentials/policy/price change.

Final retained-startup build installed after exact35829/no running retained user reparse/graceful shutdown; rollbackbefore-retained-startup-20261014. Prepared and installed8files match; asar83ca9f8b55bae2179975512bd6fd0cba2c249fecdbf13511c51714fc2aa35433. User reported unlocked; first actual CUA selection succeeded and initial indexing/loading appeared without startup error at that early snapshot. Completed actual totals/tool-panel verification pending; no all-performance claim.

Actual retained-startup native AX+screenshot agree: Overview revision3294 loaded $1,032.63 API-equivalent/2,165,867,163Tokens/9373priced/142unpriced while background indexing. Mac/Ubuntu populated, Windows not received; no startup/query error in inspected overview. User-unlock confirmation followed by same installed-app selection; no real user reparse started. Context navigation succeeded; argument cards/column visible, final populated tool snapshot pending at this checkpoint. This establishes retained-read availability, not completed first scan or sustained-load resource targets.

Actual Context native navigation loaded new argument cards/column but timed out on diagnostics/context-attribution/manifests queue and tool-activity execution; this contradicts a completed real-tool-panel performance claim. Screenshot caught a window animation and is not clean visual acceptance. No further restart or real reparse/cancel. Returned to Overview via fresh AX/Raise/rederived navigation; actual total $1,033.08 API-equivalent /2,167,819,035Tokens/9379priced/142unpriced loaded with no error in inspected returned view. Core retained-startup availability proven; full active Context query/queue performance remains open and is the next concrete issue. Full goal active.

### 2026-10-14 — Selected Context investigations

Previous actual Context timeout reproduced; readonly actual DB SQL6,899rows/2,725,067metadata characters1874ms, actual production toolActivity function via readonly prototype6900records/16groups2764ms. No constructor/DB writes/raw source reads, no p95/speedup claim. Inspected mounting: page started full diagnostics and all4child read families together.

Five selected-only sections retain tool-ranking+frozen report, tools direct200-row paging, attribution, owned-client manifests and compactions. Parent diagnostics runs only compaction, direct tools only on detail selection; selection/privacy clears new tool list. Accessible pressed navigation and responsive layout, no schema/accounting/wire/timeout change. Build/typecheck/diff/syntax passed; original native tool flow extended all5mounts,200+10paging/209calls210identities/JSONCSV/evidence/pause-resume/rotation/12tokens passed; native Context origin/truncation/negative discrepancy/matched lineage through newClient path passed. First fixture expected9 remainder ignoringorphan, corrected10; attribution script required newClient navigation, corrected routing only. Screenshot visually inspected. Actual private install/native pending; full goal active.

Private selected-Context update installed after exact41687/no running retained reparse/graceful shutdown; rollbackbefore-context-workspace-20261014. Prepared/installed8files match, asarb7c97cf9fc1b439b5bdddd97adea1dc7c33415a9703546ec02a2aaefa7177312. Actual App opened normally and Context navigation shows5pressed-state modes, defaultToolrankingselected; other heavy sections absent. Final populated actual ranking/query-error check pending at this checkpoint. Full goal active; no source/credential/price/privacy/realreparse changes.

Actual final Context native AX+screenshot consistent atrevision3317:5pressed-state modes/defaultranking,6918calls/6918identities/105unpaired,41942238capturedoutputbytes/6813of6813measuredoutputs,138344argumentbytes/34622estimates/113of6918measuredarguments.0fingerprintedcomparables remains unknown repeatedbytes, not0evidence of repetition. No QUERY_TIMEOUT/QUERY_QUEUE_TIMEOUT/INDEX_STARTUP_TIMEOUT in inspected actual ranking. This supersedes earlier eager-page failure for default ranking; standalone heavy origins/compaction sustained load and fullresource/platform gates remain unproven. Current App leftonranking. No actualreparse/cancel, clipboard/save/annotation/price/privacy/credential changes. Fullgoal active.

### 2026-10-14 — Protected fingerprint status/retry

Actual0comparable fingerprints: monitor-owned ciphertext51bytes exists; bounded15sec helper timed out with ciphertext unchanged. Cause not assigned to authorization or crypto corruption. Added phasedJSONL private pipe, closedpublicstate/phase, unchanged3secstartup, immediate explicit60secbackgroundretry, oneinflight, appquitcleanup. Key remains main/privateworker; renderer setter absent. Existing unreadable key is neverreplaced; no plaintextfallback/reset/autoreparse. New collected records can use recovered key; old observations stay.

4actualmodule/OS-boundary/Collector cases passed, finalbuild/typecheck/diff passed. Native Settings publicmetadata/retrybutton/no-set-key plus idle0/append12->24/pricing passed. Realretry/grant/reparse notperformed. Privateinstall after exact50833/no-active-reparse/gracefulstop; rollbackbefore-fingerprint-access-20261014, hash/nativephasepending. Fullgoal active; protected credential boundary retained. See fingerprint-access.md.


Actual private fingerprint update matches8files/asar2e256bd93f2f1783e235ab279c8553d124db831d58f9c24b27b943a5ceb0aecc; backupbefore-fingerprint-access-20261014. Native Settings first showed protectedkeychainphase timeout (not reader startup), narrowing phase without claiming authorization cause. User explicitly reports manually retrying and successful protectedkey read. Same actualnative Settings then shows成功讀取 with no unavailable warning; readonly tool-index initially6946records/0fingerprints, subsequent6948records/2outputfingerprints/2argumentfingerprints. This verifies real future-collection activation, not historical full fingerprint coverage. No realreparse initiated, no password/key/ciphertext disclosed, no keychain reset or app-driven credential replacement. User handled OS permission themselves; no assistantgrant. Full goalactive, broadspec/platform/resourcegates retained.


## 2026-10-15 — Completion audit and evidence-time incident order

Fullsuite202cases:198pass/4Windows-onlyskip/0fail. Initial historical/live-order failure minimized with fixedIDs/tiedupdate times; sort byrecorded evidence timestamp thenupdate time/id, unknownlast.6alert/budget casespassed; no notification/cooldown/suppression/accounting changes. Independent benchmark failure scenario nowgets10secfixturebudget/exitCode2assert; originaltimeoutcase stays1sec, productionrunner/querylimitsunchanged. Originalnativefullflow passed afterupdatingClient/Incidents routes and exactreportpreview selector; no removedassertions/timeoutraises. Build/typecheck/diffpassed.

Privateupdate exact61894/no-running-user-reparse/gracefulstop; rollbackbefore-incident-order-20261014.8buildfilesmatch installed asar60df554c886fa7d0c4d4d654477875c8e7dae37a4560f2cc403464bce710f03a. Actualopeningfirst CUA cgWindowNotFound, no restart forobservationerror; liveprocess/nativeverificationpending. Completion-audit.md records actualresults/knownfunctional gaps/contentsearch-clientpolicy-reviewedcorpus plus conditional/platform/resourceconstraints. No realuserbenchmark/reparse/cancel, source-log/credential/privacy/price/clipboard/annotation mutation; no subagents/commit/push/publicrelease. Fullgoalactive.


## 2026-10-15 — 本機經同意文字搜尋

正面文字保留及搜尋已交付，預設關閉；設定／同意／來源範圍／hard cap／到期／刪除及metadata-only邊界見local-content-search.md。19個相關及15個整合檢查通過，最後scope更正後5個content檢查通過，隔離原生Cancel／Apply／新文字／刪敏／来源定位／即時關閉及12-token不變通過。Logs /tmp/agent-monitor-local-content-tests-final.log、-integration.log、-scope-final.log、-native.log、-build-final.log、-package-final.log。原生截圖已查看，唔等於真實用戶啟用。

私有新版已安裝，prepared/installed8files match，ASAR SHA304b1f1f9f4f1099187c74fa481015e34ac7d55b1df3ee2229836ea0d6f4cf39、codesign有效，rollback before-local-content-20261015。確認唯一76039且冇進行中用戶reparse／benchmark後正常停止；CUA開新版第一次cgWindowNotFound，readonly確認實際新PID1156、空local_content表已建立、正面Project政策0、片段0。工具早前確認Mac鎖定，新版真實畫面待用戶解鎖；唔作截圖已成功聲明、唔因觀察失敗再restart。原始logs未改，原有FP／collector credentials未替換，唔啟用用戶文字／重新解析／真實benchmark。Ubuntu既有部署不變、Windows仍手動未運行。


## 2026-10-15 — 中央政策／真實Ubuntu確認

27相關檢查及隔離native流程通過，6controls cases覆蓋71政策／離線expiry／恢復／本機保留／不創建文字同意／偽造與撤銷。實際部署及receipt詳見project-policy-sync.md。Logs /tmp/agent-monitor-project-controls-checks-final.log、-build-final.log、-native-final.log、-package.log；fixture截圖已核對新政策欄。

Mac ASAR e2e460edb61b3cf9cc9fb01d31d20a417114350850c335ef8dd8f6363fbd15f0（8runtime files一致／codesign有效），PID18691；Ubuntu activePID3208165，collector52914b47f8cd9caa9f158f12d936bd1bde7e9126607a79712e119b0b773b9483。雙方原有30/180日／冇Projectpolicy；冇替用戶啟用限制。Ubuntu實際global版本0 receiptUTC2026-10-14T17:24:54.587Z，Mac實際AX／截圖rev3460一致顯示已確認1項／Windows待確認1項。Mac rollbackbefore-project-controls-20261015，Ubuntu同名binary+metadataDBbackup，credential/config未讀／替換。Windows手動ZIP11members／manifestCRC通過，SHA2ca2444b5ff0ecae57df63966515981cd5a4eb02f60bcb53fa0643495427dd77，未實機運行。

用戶解鎖後，前一版本本機文字入口亦取得真實已完成0段畫面rev3436，冇timeout；此次文字保留仍0，冇actual reparse／benchmark／原始logs／帳戶／價格／密碼／剪貼板／policy非預設變更。完整目標仍active，remainingcorpus/platform/resource/fullaccessibility審核保留。


### 2026-10-15 — Desktop storage pause/recovery and delivery

Prior turn progressed actual Windows DPAPI enrollment and formal SYNCED24903. This turn installed prepared0.1.2, then added spec18.2 Desktop scan storage failure recovery and installed0.1.3. Actual native SQLite FULL/readonly classification, controlled commit failure preserves cursor/12 tokens then recovers24, worker automatic scanning pauses beyond2sec and resumes after explicitrefresh, unrelated EBUSY remains transient. Six relevant checks passed; no full-suite rerun. Private test-only worker bundle substitutesCollector, no productfault injection switch. IsolatedElectron banner FULL/permission/cross-view/explicitretry/recovery/12tokens passed; screenshot/tmp/agent-monitor-storage-pause-native.png visually reviewed. UI mock verifies rendering/IPC; worker behavior is separately exercised. Logs/tmp/agent-monitor-storage-pause-red.log (expectedfail), -final.log, -native.log, -build.log.

Package0.1.3 fullbuild/typecheck/evaluate/signing existingcertificate guardpassed; sameDR asinstalled0.1.2, noadhocfallback. Installed8files matchcurrentdist; ASAR8b035ec931c42bc477bdcc818c86ba220c694c21ec30fb562ae2e3f4e345938b. Exactsole96322/noactive retainedreparse/benchmark beforegraceful stop, rollbackrelease-inspector/before-storage-recovery-20261015. Earlier0.1.1 backupbefore-corpus-windows-20261015 retained. Cipher51bytes/SHA cdb7942d... unchanged. Currentmain7894/listens9897. ReadonlyUTC20:39:42 afterrestart: Ubuntuauth20:39:14/ACK9252; Windowsauth20:39:24/ACK25780. No remote code/config/credential changes needed for additiveDesktop status; Windowsbinary remains3aba andUbuntu52914. ActualCuaMaclocked; one pendingmanualunlock question, no duplicate/unlock bypass/blind app restart. Full specscope/resource/a11y/fullT50/conditional modes remainopen. Noactual reparse, benchmark/paid task, projectprivacy consent, original log modification, password/keyexport/reset, subagents, commit/push/PR/publicrelease.


### 2026-10-15 — Metadata-only device activity updates / 0.1.4

Previous turn madeprogress installing0.1.3 /storagepause. Observedheartbeat/health/confirm/policyACK sentglobalchanged andtriggered9rootqueriespluspanels withoutledgerchange. Addedreceiver.activity() (samefixedmetadatafields, nototals), devices-change eventthroughworker/service/main/preload, optionalbridgeAPI andscope-independentcoalescedUIactivityreads. Root/Devicesretainfullsnapshot totals+usageRevision; per-minuteactivitypollkeepsstaleconnectivityfresh, existing60secrollingTimeCharts unchanged. Newusage/gaps/pair/enroll/revoke/offlineimport/data/privacy invalidation remainglobaldatachange. Current device labels nowstateconnectivity/policy vslastreconciledusage distinction.

Redfixture heartbeat+health produced2globaldatachanges; green6health/activity/transport checksincludingpolicyACK/readback, unchangedrevision, summarythrowsprovesactivitydoesnotreadcharging, mergepreserves12+revision andno secrets. Stricthealthfixture numbers originallystring rejected400; correctedonlyfixture, no contractweaken. ActualisolatedElectronHTTPpair/heartbeat/health rendereddevice1/17andnewcontactwith0summaryIPCreads, 12tokens/minutecharts remain. Existingnativeidle/append 12→24/pricing/noextrarendernotification passed. Screenshot/tmp/agent-monitor-device-activity-native.png viewed. Fullbuild/typecheck/diff and existingcertguardpassed; not a generalp95/resource gate.

Private0.1.4prepared/installed8filesmatch, ASARf1785bd540bbf53640e421e783c5ada0dad55d7c50e6c4e6f67ca0ccbc5686b6; sameDRas0.1.3. Exactsole7894/noactiveuserjobs/gracefulstop, rollbackbefore-device-activity-20261015. Owncipher51bytes/cdb... unchanged. Newmain20845/listens9897. Actualreadonly50querieson3-device repositoryusingrealactivitySQLmethod/read-onlyfacade: p50.307/p95.440/max5.626ms, 12logicalCPU/16GiB, notliveIPC/reference4coreworkload. UTC21:01:47 newUbuntucontact21:01:45/ACK9252, Windows21:01:39/ACK25856. No collector/config/credential/price/privacy/raw/reparse/benchmark change. MacactualUIstillpendingearlierunlock, no repeatedprompt/blindretry. Goalfullscopeactive; performance/a11y/allT50/conditional coverage remainopen. No subagents, commit/push/PR/publicrelease.


### 2026-10-15 — F09 permitted task scope / 0.1.5

ExactspecauditidentifiedTaskContract lackedindependentpermittedscope. Optional4000-char permittedScope storesimmutableoperatornote; absent/oldcontractunknown, notanexecutionpermissiongrant. Form/read-onlytrialselection/Benchmarkpreparationshowstoredscope. Reporterdefaultomit, explicitincludeTaskNotes JSON/Markdownredact/escape; no sync/notification/CSV numeric-table leakage. Fourteenexperiment/Projectprivacychecks passed. Initialreporttestdidn'tselectunusedcontract; fixedselectionandMarkdownunderscore-escaping expectation withoutweakeningguards. OwnnativeUI savedthroughactualIPC/noinjectedscript execution/defaultomit/explicitredaction passed. Nativefoundmistakenpending-reviewcontractrefinnewBenchmarkscope display; correctedpreparationselection. Full-widthformlayoutfixedandnative reran; screenshot/tmp/agent-monitor-task-scope-native.png viewed. No paid/localrealbenchmarkexecution or permissionchange.

Private0.1.5fullbuild/typecheck/diff/existingcertguardpass. Installed8filesmatchcurrentdist/ASARdd5c0ccb40a5e95aa639a7bfd1ee9b3a7917408beb679d6652974746a604a8ce. Exact20845/noactiverealreparseorbenchmark/gracefulstop; rollbackbefore-task-scope-20261015. Cipher51/cdbunchanged. Newmain40115/9897; actualUTC21:50:09 newUbuntu/Windowsauth21:49:54, ACK9252/25856. ActualMacUIstillpendingearlierunlock, no repeatprompt/keyreset. Fullgoalopen.

Concurrent1Mheadlessoriginalunitterminalby30mintimeoutnotOOM; main0/status15, firstgen0/cursor737899247/643424records/dirty0 retained. Savedunit+lastprogress. StartedseparatecheckpointresumeONLYafterterminal/SHAguard, same256M/quota1core/Nice10. ActualresumePID3253871, start643424 ->700825/805007526, secondprocesspeakRSS129728512, stillrunning/noresult. No source regeneration, overlapwriters or productionCollectorchanges; existingCollectoractive. FirstsegmentResourcePeak includesfilecache, notprocessmaxRSS. Allreference/p95/renderer/1Mterminal/physicalMac/T50/conditionalgatesremainopen.


### 2026-10-15 — 10k renderer scenario / Timeline keyboard / 0.1.6

Currentisolatedsource indexed10,000~1KiBmessages+header10001. RealAPI/nativefirst200/latest10001/next9801/ArrowDowninitial/Home/End/page200/selected-state/bounded10DOMrows checked. Redaria-pressedmissing reproduced; addedpressedstate/politeliveselecteddetail, explicitviewportoutline, initialunselectedarrowstartsfirstrow,textarea focus-visible. No ledger/scope/order/cursor/privacy changes. Scenario4stagesTabworking-set+peakmetrics nonempty/nonzero, largest186023936bytes(about177MiB)<1GiB, officialElectronKBunits verified. Scopeisdocumentedselected-run currentcode, notfulllong-termleak/allworkspace/screens/allaccessibility. Screenshot/tmp/agent-monitor-large-timeline-native.png viewed; metrics/tmp/agent-monitor-timeline-renderer-measurement.json. No whole-suite/irrelevanttest rerun. ExistingSource normal10kapi tests alreadyproven.

Private0.1.6build/typecheck/evaluate/signatureguardexistingcertpassed,sameDRvs0.1.5. Exact40115/noactiveuserjobs/ciphercdb... beforegracefulstop, rollbackbefore-timeline-keyboard-20261015. Installed8filesmatch/ASAR e7f84da59eceb7279ac1b72c5299850d1815ad5181242b862e5b3ca26e402929. Newmain51218/listener9897. ActualUTC22:01:15 receiptsUbuntu22:01:12.555/Windows22:01:12.565, ACK9252/25856, cipher51unchanged. RealMacscreenpendingoriginalunlock, no repeatedprompt. ConcurrentheadlessresumePID3253871active/running, latest847399/972775019bytes/secondprocesspeak132481024, nofinalresult/terminal. No privatekey/credential/rawlog/sourcepolicy/account/price/task/benchmark writes torealdata, userreparse, remoteCollectorupdate, subagents/commit/push/publicrelease. Fulloriginalscope/allremainingtargetsopen.


2026-10-15 0.1.7: Windows/Ubuntu receiver contacts after install confirmed, same protected fingerprint/signing identity and8runtime hashes. Seven relevant Timeline cases, typecheck/build/diff passed. Shared facets/materialized ancestry measured on same1M dataset; completed finalize report includes restart/replay andidle CPU, but Timeline p95 14.84s/max22.05s still unmet. See scale-measurement.md and STATE.md for exact limits, versions and source hashes. No broad test rerun or full-spec certification.


2026-10-15 0.1.8: two narrow failures reproduced repeated full-history paging and cache lifetime across a read-only connection replacement. SQLite TEMP scope/facets now belong to the connection and one captured query identity; full counts and old-parent/date bounds retained. Eleven relevant cases passed; test fixture readonly property setup repaired using defineProperty and independently passed. Typecheck/build/signature guard passed. Same1M synthetic readonly database, one-core/256MiB exact-final bundle: cold3723.2ms,20 consecutive pages p50 15.3/p95 18.4/max20.1ms;4200events reached; OSpeak67325952bytes. Normal terminal success; production Collector stayed active. Separate cold/reference/full-platform/UI evidence remains open. Actual Cua getApp returned cgWindowNotFound; inventory timed out/reset, no native-screen claim or blind restart.


2026-10-15 0.1.9: trueworker100events/s/500events red saw0 automatic visibleevents; green observedall500, p50 756.6/p95 1211.6/max1315.0ms,5notifications then3.1secquiet. Four relevant cases passed including full/readonly/cursor preserve/manual recovery. Isolatednative idle/append Dashboard12→24 andactualautomatic/unpriced2 status passed. Increasing cadence exposed liveLedger/Tools/Diagnostics reader overlap: actualrenderer50mschanged plus800msdiagIPC stub reproduced16 concurrent; reader nowone active+one pending perselection, completes refreshes and stops afternavigation, canonical12 unchanged. Newnative green passed. Build/typecheck/diff/existingcertsignatureguard passed. This proves bounded fixtures/interface flow, not reference/all500paint/realMacUI/fullplatform certification. See live-event-visibility.md.


2026-10-15 0.1.10 task studio: reviewed actualApp local-onlymap/onRunSelected scope behavior; do not invent remote fulltrace or globalfilter support. Embeddedmap nowtasktitle/collaboration/canonicalUSD/Token components, parentfullscope+revision guards andglobalunit persistence, automatic/custom/unpriced labels. Native actualStore/Monitor syntheticroot+child200 tokens scenario2perMillion=0.0004; Token200 andUSD return, otherRun100→0.0002, TraceDetails/Bymodel retained, Agentsearch/noresults/nodefocus/Escape/runisolation/fullgraph/totals preserved.1512px and1100px screenshots viewed; correctedmac embeddedpadding andexcessnarrow stacking. Fixtureprices only; no userpricing data writes. Build/typecheck/diff andguarded privateexistingcert package passed. See task-studio.md. ActualMacscreen/fullplatform/a11y/fullgoal remainunproven.


2026-10-15 0.1.11: RunInspector nowhas scopedlatestTaskContract/outcome readonlysummary, bounded20selectedRun/machineTrial summaries andsource evidence, immutablehistory count andexplicitpreview bounds; directexistingacceptance flow preselectsRun/contract. Unknownremainsunknown, no completion/exit0 autograde andno localexecution attributedtoCodexrun. NewTask/Agentexclusive/inclusive controls useexistingquery andset-basedledger; syncGraphScope preservesselectiononupdates; requirelocalmachine identityforgraphcanonicalmetrics. Eight relatedRunTask/Experiments casespass; native exact100/200/scenarioUSD,appendpreservesinclusive,contractnote scriptinert,unknown outcome andcorrectRun deeplink passalongexistinggraph/search/Bymodel/responsiveness checks. Fixture ID omission corrected, no importguardweakened. Build/typecheck/diff/signature and8runtimefiles passed; installed0.1.11. NotfullM3/F09/T50/platform/actualUserScreen certification.
