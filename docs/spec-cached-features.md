# Cached feature requirements recovered from the original source read

This is a recovered 2026-10-12 read, not a fresh read or a completion audit.
Original user-specified file: `Agent_Monitor_Codex_Token_Inspector_Spec.md（倉庫副本：docs/spec-reference.md）`.
Previously pinned full-file SHA-256: `afe34991f72da8cea0896ca2a0ec2538444f3374fd04e282437301e038bb6480`.
Only original feature sections with their acceptance text were recovered; other sections are not fabricated.

### F01 — Source discovery and capability inspection

**Purpose:** Establish what can actually be measured before displaying conclusions.

**Requirements**

- Discover authorized local roots and list sessions without importing every body immediately. Let the user include/exclude specific roots, projects, and dates.
- Support the documented Codex default locations through a versioned adapter. Additional/archived locations require explicit configuration and a tested format; do not assume they exist.
- Distinguish a source log on Windows from a Mac UI that merely controls Windows. Collect where compatible records are actually written.
- Display a capability matrix: usage snapshots, per-response identity, cache fields, reasoning count, tool pairing, parent-agent links, compaction events, model identity, source timestamps, and context manifests.
- Track harness version, schema fingerprint, adapter version, host OS/architecture, and inspection time. “Version unknown” is a valid state.
- Provide an explicit “Inspect a sample locally” action that reports fields and coverage without uploading content.
- Reuse existing run selection and provider discovery. Do not regress other supported harnesses while improving Codex.

**UI:** Source Setup, with `ready`, `partial`, `unsupported`, `permission_denied`, and `offline` states. A usable source with limited fields remains usable.

**Acceptance:** A compatible legacy sample is admitted with partial capabilities; a richer sample enables additional detail; an unknown schema is visibly unsupported rather than converted into zero usage. Denied folders do not crash the application or trigger requests for administrator access.

### F02 — Canonical token ledger and reconciliation

**Purpose:** Make every displayed total explainable and reproducible.

**Requirements**

- Store immutable raw observations separately from the selected canonical accounting entries.
- Prefer identified per-response usage when the adapter proves the scope. Otherwise use compatible cumulative deltas as **intervals**, not invented requests.
- Store input, cached input, optional cache write, output, reasoning, and total with independent presence/provenance flags.
- Capture available thread, session, root-turn, turn, response, model/provider, timestamp, and source-position identifiers.
- Keep cumulative turn/thread counters as control totals; never add them to their underlying responses.
- Deduplicate replay and mirrored files without suppressing two different responses that happen to use the same number of tokens.
- Resolve or expose parent/child aggregate scope. Support exclusive agent, inclusive subtree, run, project, model, machine, and date views through set-based identity rules.
- Support unknown usage on cancelled or failed attempts. A missing completion is not free execution.
- Show reconciliation results: matched, partial, conflicting, unallocated interval, or unknown population.
- Record accounting-policy and adapter versions so a later reparse can explain why totals changed.

**UI:** A ledger table with a request/interval badge, input/output components, model attribution confidence, source links, and reconciliation status. An “Explain this total” drawer lists all included entries and excluded duplicate/aggregate observations.

**Acceptance:** Reimporting a dataset ten times changes no canonical total. Adding exact response records to an already imported aggregate refines the view without adding the same usage again. Unsupported request IDs degrade to interval mode.

### F03 — Context attribution with uncertainty

**Purpose:** Explain which visible content may contribute to model input without pretending to see unavailable context.

**Requirements**

- Model each content occurrence using three independent facets:
  - **Origin:** user instruction, project file, external document/search, command output, agent-generated message, subagent handoff, skill/plugin definition, other, or unknown.
  - **Transport:** user message, tool result, injected context, summary, or other.
  - **Age/state:** newly introduced, retained, summarized, truncated, removed, or unknown.
- Use a mutually exclusive primary-origin partition for a breakdown. A file printed by a terminal is not counted again as both a project file and tool output in the same total.
- Keep original text length, observed tool payload, client-side transformed payload, and instrumented request inclusion distinct.
- Tokenize only accessible text with a known or explicitly approximate tokenizer. Record tokenizer identity/version and whether serialization overhead is included.
- Keep text, image/audio, tool-schema overhead, and unknown server additions separate. Do not estimate multimodal billing from character count.
- Track context epochs and content lineage through known summarization/truncation events.
- Show repeated exposure only when request inclusion is supported. Otherwise show an explicitly labeled scenario with assumptions, or no estimate.
- Never allocate aggregate cache reads proportionally to individual files and label the result exact.

**Reconciliation:** Compare provider input with the visible reconstruction. Do not rescale estimates merely to make a chart sum to the official count. If the reconstruction exceeds the provider total, display a reconstruction discrepancy. A positive residual from an estimated reconstruction is not proof that the remainder is a system prompt.

**UI:** “Provider usage” and “Visible context estimate” are separate panels. Category charts use an uncertainty legend. Users can open the content occurrences behind a category.

**Acceptance:** One file-content tool result occupies one primary bucket. Missing context is visible. An overcounted reconstruction produces a warning, not a negative “unknown” category. No hidden prompt or reasoning text is fabricated.

### F04 — Tool, file, skill, plugin, and instruction impact

**Purpose:** Identify high-volume operations and the context they introduce.

**Requirements**

- Pair tool calls and results by provider namespace plus call ID. Keep unpaired/ambiguous events visible.
- Capture tool name, argument metadata, duration where observed, exit/status evidence, output bytes, truncation state, and content-origin references.
- Track terminal execution, file reads/searches, patches, web/retrieval actions, subagent handoffs, and plugin/MCP calls where the source provides them.
- Separate **argument/output tokens generated by the model**, **tool payload token estimates**, and **subsequent request-input exposure**. These are different quantities.
- Aggregate repeated output by tool family and stable content identity.
- Identify visible `AGENTS.md`, skill instructions, plugin schemas, or tool definitions only when there is evidence of their presence. Installed/enabled does not mean included in every request.
- Record the source of a plugin or skill label: explicit metadata, parsed path, user annotation, or heuristic.
- Offer bounded-output suggestions such as targeted searches, relevant line ranges, or failure summaries; preserve access to complete diagnostic artifacts.


**UI:** Tool/Content Explorer showing invocation count, bytes emitted, estimated payload tokens, observed subsequent usage intervals, repeated-content findings, and applicable caveats.

**Acceptance:** A 1 MiB original log truncated to a 2 KiB model-visible result does not receive a 1 MiB input estimate. A tool call before a 100,000-token request is not assigned all 100,000 tokens. Cached exposure remains unknown at file level without supporting spans.

### F05 — Repeated-read and duplicate-content detector

**Purpose:** Surface repeated content that may be avoidable, without punishing necessary verification.

**Detection inputs:** Tool-pair records, observed output fingerprints, file/worktree identity, captured byte/line ranges, timestamps, revisions where observed, and compaction boundaries.

**Rules**

- Begin with deterministic exact fingerprints for the actual captured text or byte range. Add near-duplicate detection only after exact matching is tested.
- Distinguish `same captured content`, `overlapping captured range`, and `same path but content/version unknown`.
- Do not infer that a historical file was unchanged by hashing its current contents. A missing edit event does not prove no external edit occurred.
- Count duplicate emitted content separately from repeated retention of one original result in later requests.
- Suppress or downgrade findings after a relevant change, explicit verification instruction, source update, or compaction-related reread.
- Treat truncated comparisons as partial evidence.
- Store the reason for each finding and its suppressions.

**Default candidate rule:** At least three identical captured reads in one context epoch, with at least 2,000 estimated duplicate payload tokens. These are initial product defaults, not research-derived optimal thresholds.

**Finding example:** “Five reads returned the same captured range of `strategy.py`. Estimated repeated tool payload: 18,000 tokens. Incremental model input and avoidable cost are unknown.”

**Actions:** Open matching reads, compare versions/ranges, mark intentional, suppress for this task, or copy a targeted-read suggestion. No automatic filesystem or prompt mutation.

**Acceptance:** Same path with changed content does not trigger an identical-content claim. Two requests with identical usage numbers remain separate. Required post-edit verification is not labeled confirmed waste.

### F06 — Retry-loop and repeated-failure diagnosis

**Purpose:** Distinguish productive debugging from repeated failure with little visible progress.

**Requirements**

- Normalize command/test identity and error signatures while preserving meaningful assertion values and relevant stack locations.
- Group attempts by task, worktree, target, and context; do not merge unrelated tests because they share “failed.”
- Track intervening relevant diffs, configuration/environment evidence, changes in failing cases, and explicit progress markers.
- Differentiate compile/test failures, dependency/environment failures, permission denials, network/API retries, and long-running-process polling.
- Recognize that `poll`/`wait` calls for the same running process are not new executions.
- Separate an agent retry from provider/transport retransmission. Usage on an interrupted transport may be unknown.
- Report the union of associated observed usage intervals, not a fabricated causal “retry cost.”

**Default candidate rule:** Three comparable failures within ten minutes with the same normalized signature and no observed relevant progress. Unknown code/environment state lowers confidence; it does not prove lack of progress.

**Severity:** Informational for recurrence; warning when evidence supports stagnation; never “infinite loop” from a finite sample.

**Recommendation:** Check the root cause, environment, or task assumptions; narrow the next diagnostic step. Do not automatically reduce test coverage, increase permissions, or retry indefinitely.

**Acceptance:** A changing failing assertion with relevant edits is separated from an unchanged dependency error. Explicitly requested retry/backoff tests can be suppressed. Alerts link to each failure and relevant intervening evidence.

### F07 — Context-compaction and growth analysis

**Purpose:** Make context pressure and compaction-related tradeoffs inspectable.

**Requirements**

- Detect explicit compaction records/items through a versioned adapter; deduplicate the start/completion/legacy aliases of one operation.
- Treat lower subsequent input as a possible context change, not proof of compaction.
- Record automatic/manual/unknown trigger, start/end if available, source IDs, context epoch, nearby observed request counts, and any visible summary lineage.
- Label request input before/after a compaction as a **proxy** unless actual context snapshots were captured.
- Attribute compaction usage only when a distinct response or equivalent supported accounting scope identifies it.
- If the parent total may already contain compaction usage, reconcile before adding any separate record.
- Analyze repeated large rereads or repeated compaction within a task as candidate patterns, not proof that compression lost information.
- Show context growth separately from cumulative billed/observed token consumption.

**Metrics:** Explicit compaction count, interval between events, known attributable usage, unknown overhead, last eligible pre/post input measurements, and post-compaction duplicate-content candidates.

**Recommendation:** Consider task boundaries, durable handoffs, or bounded tool output. Do not prescribe a fixed session size without task-quality evidence.

**Acceptance:** Explicit compaction without token records shows “overhead unknown.” A model change or input drop alone does not create a confirmed compaction event. Existing cumulative totals are not reduced by a compaction merely because active context became smaller.

### F08 — Cross-agent duplicate-work analysis

**Purpose:** Identify overlapping work while preserving valuable independent review.

**Requirements**

- Compare assignment evidence, tool-result fingerprints, search targets, touched files, worktree state, and time overlap across a run's agent graph.
- Distinguish shared startup context, independent verification, intentional parallel exploration, and possible accidental duplication.
- Show handoff messages and whether earlier findings were visibly available to another agent. Absence of a logged handoff is not proof that information was unavailable.
- Avoid universal all-pairs comparison on large runs; index by content/target fingerprints and narrow candidate pairs first.
- Provide “declared purpose” annotations such as implementation, review, independent test, or research.
- Keep a duplicate-work candidate's **associated usage** separate from any unverified avoidable portion.
- Record relationships without assuming all branches are spawned subagents; distinguish forks, resumed sessions, and explicit spawn edges.

**UI:** Agent comparison with synchronized traces, common operations, differences, assignments, and a clear “intentional review” override.

**Acceptance:** Two agents independently validating an API are not automatically penalized. Identical logs mirrored between machines do not become duplicate *work*. A real repeated execution by distinct response identities remains visible.

### F09 — Outcome-aware agent efficiency assessment

**Purpose:** Relate resource use to defensible task outcomes, not to code volume or confident final messages.

**Requirements**

- Attach a task contract: objective, permitted scope, acceptance tests, relevant environment, and completion criteria.
- Record outcome as verified success, verified failure, partial, cancelled, or unverified.
- Prefer approved structured test artifacts or user-reviewed evidence over an agent's own “done” statement.
- Distinguish process exit success, test-suite success, and task acceptance. A zero exit code alone does not establish business correctness.
- Track exclusive/inclusive usage, wall-clock duration, waiting, tool-active time when measured, observed retries, artifacts, and unresolved failures.
- Do not equate lines changed, number of files, or token volume with productivity.
- Make candidate duplication a contextual indicator, not an automatic efficiency penalty.
- Compare similar tasks and report sample size; avoid a universal agent score as the default presentation.

**Derived metrics:** Tokens per accepted task across an eligible cohort, time to first passing acceptance result, and resource distributions conditional on outcome. Failed/cancelled attempts remain part of total experiment cost.

**UI:** Outcome card plus evidence drawer, not a single unexplained grade.

**Acceptance:** A failed trial remains in cohort cost. An agent that writes many lines but fails acceptance is not ranked above a small correct fix. Summed parallel durations are not displayed as wall-clock duration.

### F10 — Persistent full-history timeline and search

**Purpose:** Investigate long runs beyond the current live display window while keeping memory bounded.

**Requirements**

- Persist normalized event metadata, source pointers, usage observations, and permitted redacted excerpts in SQLite.
- Use keyset/cursor pagination and virtualized rendering. Maintain bounded batches and cancellation when the selected run changes.
- Provide chronological swimlanes for agents, turns, tools, usage, errors, findings, and compaction.
- Allow source-order navigation when timestamps are missing, equal, out of order, or affected by machine clock skew.
- Support search by agent, model, tool, file identity, event kind, time, finding, and approved text content.
- Link every ledger entry and finding to exact retained evidence, including file generation and byte/line range where available.
- Show dropped, oversized, unsupported, deleted, and unindexed regions as explicit gaps.
- Show a run's overall history even if older content is not retained; mark unavailable details rather than substituting current file content.
- Reindex deterministically after adapter changes, with old/new accounting-policy revisions retained for audit.

**Retention semantics:** “Full history” means all eligible indexed events within the selected retention/source-availability policy. It never promises recovery of content Codex did not write, the user deleted, or the monitor deliberately did not retain.

**Acceptance:** A synthetic 10,000-event run can navigate to its first and last retained events after restart. UI display caps do not change usage totals. A missing original file yields an evidence-unavailable state, not silent success.

### F11 — Budgets, anomaly alerts, and detector feedback

**Purpose:** Surface relevant changes during a run without taking control of Codex.

**Requirements**

- Allow optional run/project budgets for observed tokens, known uncached input, elapsed time, and eligible API-equivalent estimates. Keep these units separate.
- Alert on threshold crossing, large output, repeated failure, compaction bursts, and collector gaps.
- Use warm-up periods, minimum evidence, cooldowns, and a single evolving finding for the same incident. Do not emit one notification per matching event.
- For statistical anomalies, compare a sufficiently similar historical cohort and disclose sample size. Cold-start mode uses explicit thresholds only.
- Suppress retrospective notification storms during imports. Existing findings still appear in reports.
- Let the user mark findings actionable, intentional, not relevant, incorrect, or resolved; retain the annotation separately from the raw evidence.
- Show stale/partial data beside alerts. Do not predict a hard quota exhaustion time from an unknown quota-to-token relationship.
- Default notification bodies to redacted labels, not file contents, full paths, credentials, or prompts.

**Control boundary:** Alerts are advisory. The monitor does not stop a task, consume credits, change an agent configuration, or send a message into Codex automatically.

**Acceptance:** A condition recurring 100 times within one incident generates one initial alert plus controlled updates. Importing yesterday's run creates findings but no live-alert flood. A token budget uses observed/derived ledger values, not the sum of context estimates.

### F12 — Evidence-grounded optimization advisor

**Purpose:** Convert findings into specific, testable recommendations.

**Two modes**

1. **Deterministic advisor, enabled by default:** Templates turn verified detector output into suggested next actions.
2. **Optional AI explanation:** A user-selected model receives a minimal, redacted evidence bundle after explicit authorization. Core functionality does not depend on it.

**Required report structure**

- What was observed, with evidence IDs.
- Why it may matter, with the distinction between correlation and causation.
- Plausible alternative explanations and missing evidence.
- A proposed bounded change.
- Risks to correctness, coverage, reproducibility, or necessary verification.
- A validation experiment and rollback condition.
- Expected impact as unknown or a labeled scenario, not a guaranteed savings figure.

**Example suggestion:** “Replace repeated full test-log printing with a failure summary plus a saved complete log. Rerun the same acceptance task to check whether request-input usage falls without losing diagnostic success.”

**Safeguards**

- Every generated factual claim must resolve to a finding or source record. Unsupported output is omitted or labeled hypothesis.
- Treat trace text as untrusted data, including instructions addressed to the model.
- Meter the advisor's own usage separately as `monitor_overhead`; exclude it from the observed Codex task unless the user deliberately requests an all-in total.
- Do not reanalyze the advisor's own reports recursively by default.
- Proposed `AGENTS.md` edits are previews for human review, not automatic changes.

**Acceptance:** Disabling external AI preserves all rule-based findings. A malicious trace cannot instruct the advisor to upload other files. A recommendation without measured savings never says “saved 40%.”

### F13 — Before/after experiments and benchmarks

**Purpose:** Demonstrate whether an optimization helps under comparable conditions.

**Requirements**

- Define a task suite, acceptance tests, frozen input data, repository state, environment, model/configuration, and changed variable.
- Support comparisons of instructions, tool-output policy, task decomposition, or model settings. State when several variables changed together.
- Store each trial, including failures, cancellations, missing telemetry, and reruns. Never retain only favorable runs.
- Keep benchmark execution separate from passive monitoring. Running code or model requests requires explicit authorization and an isolated workspace.
- Pair variants where possible; randomize order across repeated trials where practical. Record cache state and uncontrolled provider factors rather than claiming perfect determinism.
- Compare quality first, then total tokens, uncached input where known, time, API-equivalent estimate, retries, and compaction.
- Report distributions, sample counts, and uncertainty appropriate to the experiment. A single before/after pair is descriptive, not proof of causality.
- Separate illustrative token-reduction scenarios from measured improvements on reruns.

**Acceptance:** A cheaper variant that fails the acceptance task cannot be labeled the overall winner. Failed setup trials remain visible. Benchmark reports name uncontrolled factors and telemetry gaps.

### F14 — Multi-machine collectors and central inspection

**Purpose:** Let the Mac dashboard inspect compatible Codex execution on Windows and a Linux ARM64 VPS.

**Requirements**

- Build a headless collector from shared parsing/accounting libraries; Electron must not be required on the VPS.
- Support local-only mode without networking. Remote enrollment is an explicit opt-in.
- Assign stable installation, workspace, machine, and source identities. Keep origin identity separate from the machine forwarding a copied file.
- Use authenticated, encrypted transport with device enrollment, revocation, and workspace scoping. Prefer a private network or authenticated tunnel; never assume a private IP alone is authorization.
- Default to metadata-only synchronization: counters, opaque IDs, time, statuses, detector output, and approved pseudonymous labels.
- Keep raw prompts, tool arguments/results, file paths, and code local. Fine-grained remote content requests require separate authorization.
- Persist an encrypted or equivalently protected outbound metadata spool; acknowledge only after durable ingestion.
- Resume after disconnects using ordered batch IDs, event sequence, idempotency keys, and backpressure.
- Retain local timestamps plus receiver timestamps and clock-offset uncertainty. Do not infer cross-machine causal ordering from wall clocks alone.
- Show stale/offline collector state without marking its agents completed or failed.
- Support offline export/import as a fallback using the same canonical identities.

**Capability limit:** Central metadata-only mode cannot perform new semantic analysis of raw remote traces. Sensitive-content detectors run locally and send redacted results; deep inspection requires permission.

**Acceptance:** A 24-hour disconnection followed by replay produces no duplicate accounting. A revoked machine cannot send new data. The ARM64 collector runs without a display server. Copied history is not counted again solely because it arrived from another host.

### F15 — Auditable cache, model, project, and price analytics

**Purpose:** Turn ledger data into useful comparisons without misleading accounting.

**Requirements**

- Reuse existing model/agent charts and add model-attribution provenance, price-version inspection, and aggregate reconciliation.
- Support task, project, machine, model/provider, service tier, date, and exclusive/inclusive agent filters.
- Show weighted cache-read share: `sum(known C) / sum(corresponding I)`, alongside the uncovered input amount. Do not average request percentages without weighting.
- Track model changes per eligible response or interval. Requested model, observed effective model, provider route, and quota alias are distinct fields.
- Treat custom gateways and unresolved aliases as unpriced unless the user supplies a reviewed rate card.
- Persist immutable price snapshots and allow explicit historical-as-of versus current-equivalent views. Do not silently reprice old exported reports.
- Evaluate context-length pricing rules at eligible request scope, not on cumulative run input.
- Label estimates as API-equivalent, specify assumptions/currency, and show known subtotal plus unpriced coverage.
- Include large-cache and low-cache analysis without equating cache misses with waste.

**Acceptance:** A mixed-model run is not wholly priced at its last model's rate. Missing cache fields do not become zero-priced cached usage. Two price snapshots produce independently reproducible reports.

### F16 — Reports, export, and read-only integration

**Purpose:** Make findings reviewable outside the application and usable by a coding assistant.

**Reports**

- Per-run Markdown report: summary, evidence coverage, ledger totals, major findings, agent outcomes, recommendations, and limitations.
- Machine/project summary: time-bounded eligible usage and data freshness.
- Experiment report: variants, quality outcomes, complete trial population, resource distributions, and conclusions.
- JSON export of normalized data with schema/adapter/policy versions; CSV export of approved tabular views.
- Optional self-contained HTML report only after export escaping/security tests pass. PDF is not required for the initial product.

**Read-only query surface**

- Structured IPC/query methods for runs, usage, findings, and evidence references.
- An optional read-only MCP adapter may expose those same methods so a coding assistant can request a redacted report.
- No arbitrary SQL, arbitrary path reads, terminal execution, prompt injection, or account-changing methods.
- Query limits, provenance, result truncation, and denied-content states are explicit.

**Security:** Preview the redacted export before saving/sending. Prevent spreadsheet formula execution in CSV text cells. Include evidence availability; a report with missing retained source text must say so.

**Acceptance:** Exported totals reconcile to the same ledger revision used by the UI. Opening exported HTML cannot execute trace-provided scripts. A read-only assistant integration cannot edit the user's project.

### F17 — Privacy, permissions, and retention

**Purpose:** Extend observability without creating an uncontrolled copy of sensitive developer activity.

**Requirements**

- Request access only to selected trace roots and explicitly approved optional artifact paths.
- Never collect Codex authentication files, browser cookies, SSH keys, API keys, full environment dumps, or arbitrary home-directory contents.
- Treat prompts, code, tool output, paths, search queries, project names, and derived fingerprints as potentially sensitive.
- Keep detection local by default. Apply redaction and field allowlists before networking or external AI calls.
- Use workspace-scoped keyed fingerprints where equality is needed across enrolled machines. Do not expose globally comparable hashes of short secrets or filenames.
- Keep renderer filesystem/network privileges narrow. Validate all IPC, escape untrusted content, and prevent path traversal and unauthorized symlink targets.
- Use OS-protected secrets storage; do not hardcode keys or store tokens in plaintext configuration.
- Provide per-project content retention, metadata retention, export restrictions, and deletion controls. Explain which monitor-owned data will be removed and which upstream logs remain untouched.
- Provide audit records for enrollment, remote detail access, export, and permission changes, without logging the sensitive content itself.
- Disable telemetry by default; any opt-in diagnostic payload is previewable and bounded.

**Acceptance:** A supplied secret marker appears neither in synchronized metadata nor in an advisor payload. Deleting monitor records does not delete Codex logs. Reimport suppression/tombstones prevent an opted-out run from immediately returning through sync.

### F18 — Data quality and collector health

**Purpose:** Make measurement failure visible before users trust a misleading total.

**Requirements**

- Show file coverage, offsets, lag, last successful parse, schema fingerprint, parser errors, skipped bytes, duplicate observations, conflicts, and unknown event types.
- Distinguish application telemetry, provider usage, context estimates, and user annotations.
- Allow local diagnostic export with secrets/content excluded by default.
- Detect unsupported upgrades and downgrade capabilities instead of guessing at renamed fields.
- Reconcile totals across response, interval, thread, and optional account scopes only when those scopes are compatible.
- Provide a deterministic reparse operation that writes a new analysis revision before replacing the active view.
- Keep the last valid read model available after a parser crash; label stale results.
- Meter the monitor's own CPU, memory, storage, and optional advisor tokens.

**Acceptance:** A malformed line generates a visible gap/error without blocking later valid lines. An unsupported event version does not crash other sources. A partially parsed run cannot appear as “complete and verified.”

### F19 — Optional account quota and aggregate reconciliation

**Purpose:** Present authorized account summaries beside local evidence without mixing their scopes.

Codex App Server documents `account/usage/read` and `account/rateLimits/read`; availability depends on supported authentication and service responses. [S10]

**Requirements**

- Feature-detect method support and account availability; remain fully functional when unavailable.
- Default to passive quota fields already present in authorized local records. A live account integration needs a documented, approved connection.
- Display provider-defined window duration, reset time, measurement timestamp, and unknown fields. Do not hardcode every account to a five-hour or weekly window.
- Compare account aggregates with local totals only after checking identity, time zone, dates, definitions, and source coverage.
- Label unmatched usage as a reconciliation gap; do not assign it to a guessed agent or machine.
- Never extract or duplicate authentication stores to implement monitoring.
- Do not use write operations that reset limits, consume credits, send account emails, log out, or otherwise change the account.

**Acceptance:** API-key-only or unsupported accounts show an explanatory unavailable state. Quota percentages are not converted into invented exact token allowances. Account totals and local ledger totals remain separately visible.

### F20 — Optional instrumented context manifests

**Purpose:** Improve attribution when the user deliberately controls an eligible client or execution wrapper.

**Requirements**

- Remain disabled in passive-monitor mode; do not intercept an unrelated Desktop process.
- Instrument only documented/owned client boundaries. Capture an immutable manifest immediately before each controlled request, after known client-side transformations.
- Record request identity, content-item IDs, ordering, origin, byte lengths, selected tokenizer estimates, truncation/summarization operations, and consent scope.
- Store payload text only under a separate content policy; metadata manifests may be sufficient for some analysis.
- Link actual response usage to the manifest. Preserve missing response usage and failed attempts.
- Mark client-visible context as client-visible, not full server-side context. A manifest cannot reveal unobserved server additions or exact cache-span behavior.
- Separate measurements of the user's normal Desktop workflow from experiments using an instrumented wrapper; do not silently replace one with the other.

**Acceptance:** A controlled fixture proves content-order and request-ID matching. Removing a known tool payload updates the visible-context estimate but does not claim provider savings until a comparable execution measures them. Existing Desktop sessions remain untouched.

## Recovery evidence

- F01: retained original tool output line 1295, call `call_AVYEivjdLksQZM6FqCPihcrH`.
- F02: retained original tool output line 1295, call `call_AVYEivjdLksQZM6FqCPihcrH`.
- F03: retained original tool output line 1295, call `call_AVYEivjdLksQZM6FqCPihcrH`.
- F04: retained original tool output line 1517, call `call_pcaM9ZuG5QtFuZFi3zk08yRS`.
- F05: retained original tool output line 1295, call `call_AVYEivjdLksQZM6FqCPihcrH`.
- F06: retained original tool output line 1295, call `call_AVYEivjdLksQZM6FqCPihcrH`.
- F07: retained original tool output line 1295, call `call_AVYEivjdLksQZM6FqCPihcrH`.
- F08: retained original tool output line 1295, call `call_AVYEivjdLksQZM6FqCPihcrH`.
- F09: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F10: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F11: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F12: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F13: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F14: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F15: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F16: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F17: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F18: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F19: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
- F20: retained original tool output line 1319, call `call_yZuBldhMU5Ho5vPB8az9A8YS`.
