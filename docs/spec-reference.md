# Agent Monitor Extension: Codex Token Inspector

> Detailed product requirements, engineering architecture, and implementation handoff.
> Preserve the existing agent-monitoring experience; add trustworthy token accounting, evidence-linked diagnosis, and measurable optimization.

| Document field | Value |
|---|---|
| Specification version | 1.0 |
| Prepared | 2026-10-12 |
| Status | Proposed implementation specification; not a statement that the features are implemented |
| Primary upstream | `donvito/agent-monitor` |
| Primary harness | Codex Desktop / CLI, subject to the actual records available on each installation |
| User interface target | Existing desktop application, with English and Traditional Chinese labels |
| Deployment target | macOS Apple Silicon dashboard; Windows x64 dashboard/collector; Linux ARM64 headless collector |
| Implementation approach | Extend compatible upstream components rather than rebuild the existing application |
| Technical language | English, with a Traditional Chinese executive overview |
| Source-review scope | Public documentation and selected source files; no access to the user's live Codex session logs |

## 中文摘要

這份規格的目標，是將 Agent Monitor 從「顯示 Agent 做了甚麼、用了多少 Token」，擴展成「指出哪些階段值得調查、提供可追溯證據，並驗證優化是否有效」的工具。

保留現有 Agent Graph、Trace Viewer 及用量圖表。新增的核心包括：可靠的請求用量帳本、Context 來源分析、工具輸出影響、重複讀檔偵測、重試循環偵測、跨 Agent 重複工作分析、Context Compaction 分析、完整歷史時間線、任務成果與效率評估、優化建議、前後對照實驗，以及 Mac／Windows／ARM64 VPS 集中監察。

**最重要的界線：有來源的 Token 計數、由可見內容推算的 Token、以及無法確認的部分，必須分開顯示。** 不能把「重複讀取」直接當作浪費，也不能把某個時間段的全部用量歸咎於其中一個工具。軟件預設只讀取紀錄，不會自動修改專案、停止 Codex、使用帳戶額度或上傳原始對話。

建議先完成單機資料管線、可信帳本及完整歷史，再做偵測與診斷，最後加入跨機同步。每一階段都有具體驗收條件；不要求一次重寫整個專案。

---

## Contents

1. [Implementation contract and evidence status](#1-implementation-contract-and-evidence-status)
2. [Verified upstream baseline and corrections](#2-verified-upstream-baseline-and-corrections)
3. [Product goals, users, and non-goals](#3-product-goals-users-and-non-goals)
4. [Semantic model and accuracy contract](#4-semantic-model-and-accuracy-contract)
5. [Token accounting rules and worked examples](#5-token-accounting-rules-and-worked-examples)
6. [Complete feature inventory](#6-complete-feature-inventory)
7. [Detailed feature specifications](#7-detailed-feature-specifications)
8. [Source modes and capability ladder](#8-source-modes-and-capability-ladder)
9. [Ingestion, identity, and reconciliation algorithm](#9-ingestion-identity-and-reconciliation-algorithm)
10. [Proposed architecture and repository integration](#10-proposed-architecture-and-repository-integration)
11. [Canonical data contracts](#11-canonical-data-contracts)
12. [Storage design, retention, and migrations](#12-storage-design-retention-and-migrations)
13. [Query, IPC, synchronization, and optional MCP contracts](#13-query-ipc-synchronization-and-optional-mcp-contracts)
14. [User interface requirements](#14-user-interface-requirements)
15. [Security design and threat model](#15-security-design-and-threat-model)
16. [Detector logic, scoring, and optimization claims](#16-detector-logic-scoring-and-optimization-claims)
17. [Benchmark protocol and decision rules](#17-benchmark-protocol-and-decision-rules)
18. [Performance and operational targets](#18-performance-and-operational-targets)
19. [Delivery milestones and implementation backlog](#19-delivery-milestones-and-implementation-backlog)
20. [Validation plan and acceptance fixtures](#20-validation-plan-and-acceptance-fixtures)
21. [Risks, limitations, and decision log](#21-risks-limitations-and-decision-log)
22. [Proposed configuration example](#22-proposed-configuration-example)
23. [Synthetic end-to-end walkthrough](#23-synthetic-end-to-end-walkthrough)
24. [Coding-agent handoff and working instructions](#24-coding-agent-handoff-and-working-instructions)
25. [Definition of done and traceability](#25-definition-of-done-and-traceability)
26. [Source register and verification notes](#26-source-register-and-verification-notes)

---

## 1. Implementation contract and evidence status

The words **MUST**, **SHOULD**, and **MAY** indicate mandatory requirements, recommended defaults, and optional extensions within this proposed product. They are not claims about upstream behavior.

Every requirement below is one of:

- **Preserve:** a capability observed in upstream documentation or selected source files.
- **Extend:** an existing capability that needs a stronger contract, more detail, or persistent storage.
- **Add:** a proposed capability not established by the inspected baseline.
- **Conditional:** dependent on the actual Codex version, captured fields, authorization, or explicit user consent.

“Not established by the inspected baseline” does not mean an exhaustive audit proved that no implementation exists anywhere in the repository.

### 1.1 Baseline verification before coding

Public `main` sources were inspected for this specification. An immutable upstream commit SHA was not established in this environment. Before implementing, the developer MUST record:

1. The actual upstream checkout SHA, its license/permission status, and the local working-tree state.
2. The installed Codex version and host application version on each test machine.
3. Which source files, event envelopes, and identifiers are actually emitted by that installation.
4. A synthetic or explicitly approved, locally redacted fixture demonstrating each claimed capability.
5. The results of upstream tests before any changes.

The existence of a struct in public Codex source does **not** prove that a user's installed Desktop writes that struct to an accessible JSONL file. Capability detection takes precedence over assumptions about version numbers.

Public repository visibility is not a substitute for checking reuse and redistribution permissions. This document does not establish those permissions. Do not publish a derived binary until that check is complete.

### 1.2 Deliverable boundaries

This document specifies the product and its acceptance criteria. It does not install Agent Monitor, alter the user's repositories, inspect private session contents, or certify upstream security. All numerical walkthroughs are synthetic.

## 2. Verified upstream baseline and corrections

The following observations are source-backed, not implementation promises. Source IDs resolve in Section 26.

| Area | Inspected baseline | Treatment in this extension |
|---|---|---|
| Agent graph, trace inspection, per-agent/model usage | Documented by upstream. [S01, S02] | Preserve; add evidence links and richer analysis. |
| Local discovery | Codex sources include `$CODEX_HOME/sessions` or `~/.codex/sessions`; alternative trace-root configuration is documented. [S03] | Extend with capability reporting and multiple authorized roots. |
| Historical detail | Live detail is bounded to 200 normalized entries per agent and 64 KiB per displayed entry; JSONL metrics are folded over the selected file. [S04] | Add persistent paginated history, not unbounded RAM. |
| Per-request information | `TraceEntry.usage` already has input/output fields; the inspected Codex adapter associates `last_token_usage` with a usage entry. [S05, S06] | Strengthen identity, provenance, reconciliation, and component detail; do not claim request usage is wholly absent. |
| Pricing | Upstream describes estimates, rate snapshots, partial/unpriced coverage, and model attribution. [S07] | Preserve; extend auditability, versioning, and explicit scope. |
| Architecture | Electron/React implementation with separate main, traces, graph, shared, and renderer areas. [S04, S08] | Reuse this structure; avoid a gratuitous Tauri rewrite. |
| Codex protocol | Public source defines usage components, cumulative/last usage, and best-effort response usage records with correlation IDs. [S09] | Conditional adapter support; inspect live emission before enabling. |
| Codex App Server | Documents token-usage notifications, tool/collaboration items, context-compaction items, and account usage/rate-limit reads. [S10] | Optional authorized integration; not a universal tap into another Desktop process. |

### 2.1 What the main limitation actually is

The extension is not needed because upstream “cannot count any request tokens.” It is needed to make the path from **usage observation → accounting decision → diagnostic finding → validated improvement** durable and auditable.

A trace can reveal repeated actions without proving those actions were unnecessary. A token counter can be accurate for the records it covers without proving that all requests were recorded. A tool result can be large without proving that its full text reached the model. The proposed product makes these distinctions visible rather than hiding them behind one attractive total.

## 3. Product goals, users, and non-goals

### 3.1 Primary questions

The application should answer, in order:

1. What usage was actually observed, for which agent, task, model, and machine?
2. How complete is the evidence, and which totals reconcile?
3. During which phases did usage increase, and what operations occurred there?
4. Which patterns deserve investigation: duplicate content, failed retries, large outputs, repeated compaction, or overlapping agent work?
5. What change is worth testing, and did it preserve task quality while improving resource use?

### 3.2 Representative workflows

**Investigate a large development task.** Select a run, inspect its usage ledger, open the largest eligible interval, view the associated tool results and findings, and export a redacted evidence-backed report.

**Investigate a subagent.** Select an agent node, compare exclusive usage with the whole subtree, inspect assigned work and independently verified outcomes, and distinguish useful independent review from accidental duplication.

**Improve project instructions.** Compare an existing `AGENTS.md` with a proposed revision against the same benchmark tasks and acceptance tests. Keep failed trials visible.

**Monitor remote execution.** Use the Mac dashboard to inspect metadata collected on Windows and an ARM64 VPS. Remote detailed content remains unavailable unless separately authorized. Machine connectivity and agent execution status are different states.

### 3.3 Non-goals

The initial releases MUST NOT:

- Recover hidden model reasoning or private server-side prompts.
- Present API-equivalent estimates as subscription billing or quota deductions.
- Automatically edit code, weaken tests, terminate agents, restart sessions, or change prompts.
- Replace the user's Codex workflow with an unrelated agent platform.
- Claim complete request visibility when only cumulative snapshots are available.
- Turn every repeated read, failed test, or cached input token into “waste.”
- Require a paid AI service for the core collector, ledger, timeline, or rule-based diagnostics.
- Scrape process memory, intercept private Desktop traffic, or copy authentication stores.

## 4. Semantic model and accuracy contract

### 4.1 Entities must remain distinct

| Entity | Meaning |
|---|---|
| Workspace | Monitor-owned security and configuration boundary. |
| Machine | An enrolled computer or headless host; not an agent. |
| Source stream | An identified log/event origin, including file generations and observer replicas. |
| Project | A user-approved grouping of repositories/worktrees; directory-name similarity alone is insufficient. |
| Run/task | A user-defined task or causally related root turn and descendants; the grouping rule is stored. |
| Thread | The provider's conversation identity, where available. |
| Session | Provider session identity, where available; not assumed identical to thread. |
| Turn | A user/agent interaction scope that may contain many model requests and tool calls. |
| Response/request | A model completion with a supported identity; failed attempts may have no usage. |
| Usage interval | A span between compatible cumulative snapshots; not automatically one request. |
| Tool invocation | A tool call/result lifecycle, preferably linked by a stable call ID. |
| Context item | A visible or instrumented contribution to model input, with origin and transformations. |
| Finding | A diagnostic hypothesis supported by explicit evidence references. |
| Experiment | A controlled comparison with task-quality and resource-use outcomes. |

### 4.2 Provenance is per value, not just per screen

Every metric MUST carry a value or `null`, a provenance label, scope, source references, and relevant assumptions.

| Label | Meaning | Example |
|---|---|---|
| `observed` | Copied from a supported source field. | Response input count reported by a provider. |
| `derived` | Deterministic calculation from compatible observations. | Difference between two cumulative snapshots in the same accounting epoch. |
| `estimated` | Depends on reconstruction, tokenization, attribution rules, or a scenario. | Tokenized text of a captured tool result. |
| `unknown` | Evidence does not support a value. | Cache allocation to one file without a span-level map. |
| `conflicted` | Sources disagree or violate a validated invariant. | Same response identity with incompatible final usage counts. |

Use separate fields for `measurement_origin` and `provenance`. An observed application-generated estimate is **not** automatically a provider-measured count. Origins include `provider_response`, `codex_counter`, `monitor_calculation`, `tokenizer`, and `user_annotation`.

A hypothesis confidence label such as low/medium/high is a separate concept. Do not present an uncalibrated rule score as a statistical probability.

### 4.3 Missing is not zero

Absent cached input, reasoning, model identity, or timestamps MUST remain unknown. A known zero is valid only when the source explicitly reports zero or a verified source contract implies it. Imported sources that deserialize missing fields to zero require special care: retain whether the original field was present.

### 4.4 Completeness is multidimensional

Show separate coverage dimensions:

- Discovered/eligible files indexed and bytes processed.
- Known requests with final usage versus known requests without final usage.
- Usage assigned to a response, interval, or only an aggregate.
- Timed versus untimed usage.
- Identified versus unidentified models.
- Visible context attribution and pricing coverage.
- Remote machine freshness and sources not enrolled.

When the total number of real requests is unknown, do not calculate a fake “100% request coverage.” Use “all discovered records processed; total request population unknown.”

## 5. Token accounting rules and worked examples

### 5.1 Canonical components

The monitor's canonical contract uses input that includes cache subsets and output that includes reasoning. Preserve native provider fields separately and normalize only through a tested adapter. Upstream's shared usage contract makes the same subset distinction. [S05]

For a validated record, let:

```text
I = input_tokens
C = cached_input_tokens
W = cache_write_input_tokens, when independently exposed
O = output_tokens
R = reasoning_output_tokens
T = normalized total_tokens

T = I + O
uncached_input = I - C                         # only when I and C are known
non_reasoning_output = O - R                  # only when O and R are known
cache_read_share = C / I                      # undefined when I = 0
```

`T + C + R` is invalid double counting. `non_reasoning_output` is not necessarily the visible final answer: structured tool-call output can also be included.

`W` MUST NOT be added to `I` a second time. Whether cache-read and cache-write categories are disjoint, and how they are priced, is adapter-specific. Never borrow another provider's cache-write rules.

If native `total_tokens` differs from `I + O`, keep the original value, raise a semantic/reconciliation issue, and do not silently rewrite evidence. Application context-window estimates and provider usage must be separate record kinds. The inspected Codex protocol contains context-window helper logic as well as usage data; adapters must not treat every number named “total” as completed-response usage. [S09]

### 5.2 Repeated context is counted per eligible request

Synthetic example, not live user data:

| Response | Input | Cached input, included | Output | Reasoning, included | Total |
|---|---:|---:|---:|---:|---:|
| A | 12,000 | 8,000 | 1,000 | 600 | 13,000 |
| B | 19,000 | 12,000 | 1,500 | 900 | 20,500 |
| C | 22,000 | 16,000 | 2,000 | 1,200 | 24,000 |
| **Sum** | **53,000** | **36,000** | **4,500** | **2,700** | **57,500** |

Uncached input is 17,000. Non-reasoning output is 1,800. The run did not have 53,000 unique input tokens: previously retained context may appear in multiple requests.

A tool result with 4,000 estimated tokens is created after A. If supported context manifests show it included in both B and C, its estimated exposure is 8,000 input-token occurrences. This is not automatically 8,000 uncached tokens, 8,000 avoidable tokens, or a causal savings prediction.

### 5.3 Cumulative observations are not additive transactions

Suppose a thread has cumulative totals of 11,000, then 33,000, then another unchanged 33,000.

The observed cumulative total is 33,000, not 77,000. The increase between the first two observations is 22,000. If the first observation lacks a known zero baseline, the initial 11,000 belongs in an “earlier/untimed usage” bucket, not in the minute when the file was imported.

Where the same responses also have per-response records, use those records for the detailed ledger and retain cumulative totals as reconciliation controls. Never add both representations.

### 5.4 Reset, correction, and conflict rules

A falling cumulative counter is not enough to prove a reset. Check source epoch, thread identity, schema semantics, provider corrections, rollback events, and out-of-order arrival. File rotation or collector restart does not by itself create a new billing/accounting epoch.

If the reason is unresolved, quarantine the affected interval and display a gap/conflict. Do not silently clamp a negative delta to zero or manufacture a compensating request.

A confirmed same-scope counter adjustment is stored as a distinct adjustment/reconciliation record, not as a negative model request.

### 5.5 Agent hierarchy totals

Maintain `exclusive_usage` for an agent's own unique responses and `inclusive_usage` for the union of eligible descendant responses. Summing inclusive totals across parent and children double-counts usage.

Context copied into a newly executed child request is real new request input. A historical event copied into a forked transcript is not necessarily a newly executed request. Distinguish content inheritance from historical usage replay.

### 5.6 Pricing and quota are separate layers

For an eligible simple rate card without separate cache-write treatment:

```text
API-equivalent estimate =
    ((I - C) * input_rate + C * cache_read_rate + O * output_rate) / 1_000_000
```

A separate cache-write formula is enabled only after disjointness and price semantics are verified. Rates must include model/provider, currency, effective date, source, relevant tiers, and any per-request thresholds. Unknown fields result in partial or unavailable estimates.

Do not add a reasoning surcharge unless the verified provider contract explicitly requires one. Do not convert token totals into a subscription percentage. Account quota snapshots are a different observed series.

## 6. Complete feature inventory

Priority is implementation order, not a promise of equal accuracy in every source mode.

| ID | Capability | Treatment | Priority / milestone |
|---|---|---|---|
| F01 | Source discovery, version/capability inspection, onboarding | Extend | P0 / M0-M1 |
| F02 | Canonical request/interval token ledger and reconciliation | Extend | P0 / M1 |
| F03 | Context attribution with observed/estimated/unknown separation | Add, conditional | P1 / M2; deeper mode M6 |
| F04 | Tool, file, skill, plugin, and instruction impact analysis | Extend/add | P1 / M2 |
| F05 | Repeated-read and duplicate-content detection | Add | P1 / M2 |
| F06 | Retry-loop and repeated-failure diagnosis | Add | P1 / M2 |
| F07 | Context-compaction and context-growth analysis | Add/extend | P1 / M2 |
| F08 | Cross-agent duplicate-work analysis | Add | P2 / M3 |
| F09 | Outcome-aware agent efficiency assessment | Add | P2 / M3 |
| F10 | Persistent full-history timeline, search, and evidence navigation | Extend | P0 / M1 |
| F11 | Budgets, anomaly alerts, and detector feedback | Add | P1-P2 / M2-M3 |
| F12 | Evidence-grounded optimization advisor | Add | P2 / M3 |
| F13 | Before/after experiments and reusable benchmark suite | Add | P2 / M4 |
| F14 | Multi-machine collection and centralized inspection | Add | P3 / M5 |
| F15 | Auditable cache, model, project, and price analytics | Extend | P1-P2 / M2-M3 |
| F16 | Redacted reports, data export, and read-only query integration | Add/extend | P1-P2 / M2-M3 |
| F17 | Privacy, permissions, secure content handling, and retention | Extend | P0 / every milestone |
| F18 | Data-quality, compatibility, and collector-health console | Add | P0 / M0-M1 |
| F19 | Optional account quota and aggregate reconciliation | Conditional | P3 / M6 |
| F20 | Optional instrumented context manifests | Conditional | P3 / M6 |

All features require the acceptance tests in their detailed specification and the cross-cutting validation in Section 20.

## 7. Detailed feature specifications

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

## 8. Source modes and capability ladder

Choose the least invasive mode that answers the user's question.

| Mode | Source | Strongest defensible output | Key limitation |
|---|---|---|---|
| A: passive logs | Authorized local traces | Observed counters, supported event associations, estimates from visible content | Some requests/context may not be recorded. |
| B: supported App Server connection | Events from an instance/client the user is authorized to observe | Better lifecycle/correlation detail where provided | Not guaranteed to attach to a separately running Desktop instance. |
| C: instrumented owned client | Client-visible request manifests plus response usage | Stronger item inclusion and transformation evidence | Still not full server internals; workflow differs from passive Desktop. |

### 8.1 Granularity ladder

1. **Aggregate only:** Show thread/run totals and missing detail.
2. **Interval:** Compatible snapshot differences; show a span, not a single request.
3. **Identified response:** Link final usage to a supported response identity.
4. **Context manifest:** Link client-visible items to an identified response.
5. **Provider-compatible span evidence:** Enable only when an actual source supports it; do not claim this tier merely because a tokenizer is available.

The UI should expose the current tier for each run. The MVP must remain useful at tiers 1-3; tier 4 is not a prerequisite for launching the core product.

### 8.2 Field mapping policy

The inspected sources include `total_token_usage`, `last_token_usage`, and the public `TokenUsageRecord` type. [S06, S09] The actual wire envelope for each supported runtime MUST be established from a fixture rather than invented in this specification.

An adapter mapping manifest must record:

```text
adapter_id and version
harness/client version or supported schema fingerprints
recognized event envelopes
native field -> normalized field mapping
native counter scope and reset/correction semantics
which counts include cache and reasoning subsets
identity/deduplication rules
timestamp units and missing-field handling
capabilities enabled and evidence fixtures
known ambiguities and downgrade behavior
```

Never deserialize arbitrary similar-looking records into the canonical ledger solely because they contain `input_tokens`.

## 9. Ingestion, identity, and reconciliation algorithm

### 9.1 Ordered pipeline

```text
Authorized roots / optional event connection
    -> source discovery and capability detection
    -> bounded reader with durable cursor
    -> native observation store
    -> versioned adapter normalization
    -> identity resolution and replay suppression
    -> canonical accounting selection / reconciliation
    -> graph, content, tool and context indexes
    -> deterministic detectors
    -> query read models, UI, exports
    -> optional redacted AI explanation
```

### 9.2 Reading and durability

For each source file, persist a logical source ID, observed file identity, generation, last committed complete-record byte offset, line number, and prefix/checkpoint fingerprint.

Read complete records incrementally. Buffer an incomplete final line within a fixed limit; do not mark it permanently malformed until a record boundary or explicit size limit resolves the state. Handle UTF-8 split boundaries. A file change notification is a hint to rescan metadata, not proof that exactly one new event exists.

Write normalized observations and advance the cursor in the same transaction. On crash, replay may occur, but canonical accounting must be idempotent. Truncation, replacement, or rotation creates a new file generation while logical accounting identity is evaluated separately.

### 9.3 Identity hierarchy

- Prefer provider response identity plus workspace/provider/explicit execution scope when supported.
- Link a raw observation using source stream, generation, and byte range. Use an observation payload fingerprint to detect changed content at the same location.
- Use thread/turn/tool IDs only within their documented namespace. A tool call ID is not necessarily globally unique.
- A response identity observed on two forwarding machines can resolve to one execution only when origin/identity evidence supports it.
- Equal timestamps, token counts, or message text are insufficient to deduplicate real execution.
- Without a stable provider identity, replay suppression is confined to proven source replicas or explicit import provenance. Ambiguous cross-machine matches remain unresolved instead of being deleted.
- Keep superseded observations for audit under retention policy; do not mutate source logs.

### 9.4 Selecting accounting entries

For each compatible accounting scope:

1. Validate field presence, non-negativity, and subset semantics.
2. Select supported final response records, preserving conflicting alternatives.
3. Order cumulative controls by semantic sequence where available, not only arrival time.
4. Determine covered ranges and known zero/previous baselines.
5. Derive interval usage only for uncovered compatible ranges.
6. Prevent overlap between response entries and intervals/aggregates covering them.
7. Keep untimed/prior-history buckets separate.
8. Reconcile selected entries with controls; report remaining gaps or conflicts.
9. Recompute affected read models and finding revisions.

Do not invent evenly spaced requests inside an aggregate interval. Time-bucket charts must show whether usage is attributed by actual response time, interval, or unknown time.

### 9.5 Finding accounting

One response can support several findings. Use a many-to-many relation between findings and accounting entries. For an overall “usage associated with findings” figure, take the **union** of eligible entries, not the sum of finding subtotals.

Even the union is not “avoidable usage.” Savings require a counterfactual experiment or an explicitly labeled scenario.

## 10. Proposed architecture and repository integration

### 10.1 Architecture decision

Retain the existing Electron/React application and provider-independent layers observed in upstream. [S04, S08] Extract reusable headless components before adding multi-machine support. Use SQLite for local durable indexes; do not introduce a remote database requirement for the MVP.

The proposed application-specific modules below are design choices, not claims about files already present:

```text
src/
  main/                       # preserve Electron lifecycle and narrow IPC
  traces/                     # preserve/adapt provider detection and normalization
  graph/                      # preserve agent/run relationship logic
  shared/                     # extend typed contracts and provenance
  renderer/                   # preserve UI; add screens/components
  accounting/                 # NEW: canonical usage ledger and reconciler
  storage/                    # NEW: SQLite migrations, cursors, indexed read models
  context/                    # NEW: content lineage and attribution estimates
  diagnostics/                # NEW: deterministic detectors and finding lifecycle
  reporting/                  # NEW: export, templates, evidence bundles
  benchmarks/                 # NEW: trial metadata and comparison analysis
  transport/                  # NEW later: enrollment, batches, acknowledgments
  collector/                  # NEW: headless entry point without Electron imports
  integrations/               # NEW optional: read-only MCP / approved app-server client
```

Exact directories may change after inspecting the pinned checkout. Preserve existing public contracts until migration tests pass.

### 10.2 Process responsibilities

| Component | Responsibilities | Must not do |
|---|---|---|
| Renderer | Display bounded read models, collect user choices | Arbitrary filesystem reads, secret access, execution of trace content |
| Main process | Permission checks, narrow IPC, local lifecycle | Parse arbitrarily large traces on the UI-critical path |
| Collector/worker | Authorized reads, normalization, deterministic extraction | Modify Codex sources or silently upload payloads |
| Accounting worker | Identity selection, reconciliation, aggregates | Guess missing requests or billable totals |
| Diagnostic worker | Rule evaluation, evidence references | Stop/change Codex tasks automatically |
| Local storage service | Transactions, migration, retention, query limits | Accept arbitrary renderer SQL |
| Optional receiver | Authenticated scoped ingestion and acknowledgments | Merge untrusted identities across workspaces |
| Optional advisor | Explain approved evidence bundles | Browse local files or call tools based on trace instructions |

### 10.3 Dependency policy

Prefer existing dependencies where suitable. Add new libraries only with a stated purpose, platform compatibility, maintenance/security review, and tests. Pin the build through the repository lockfile.

Use one reviewed SQLite binding compatible with both the Electron build and the chosen headless runtime, or isolate bindings behind the same repository interface. Prove native-module compatibility on macOS ARM64, Windows x64, and Linux ARM64 before promising packaged support. Do not pin speculative future library versions in this document.

Keep tokenizer support pluggable. Unsupported models use an explicit approximate tokenizer or no estimate; they never silently inherit an allegedly exact one.

## 11. Canonical data contracts

The following TypeScript describes the **proposed monitor contracts**, not an upstream Codex wire schema. Implement runtime validation in addition to static types.

### 11.1 Numbers, identifiers, and provenance

Use integer-safe storage for tokens. SQLite signed 64-bit integers are suitable within checked limits; use `bigint` internally where needed and base-10 strings across JSON boundaries. Reject overflow instead of silently losing precision. Monetary estimates use a decimal representation, never uncontrolled binary floating-point accumulation.

```ts
type Id = string;
type IntegerString = string; // validated /^-?(0|[1-9][0-9]*)$/; range-checked

type Provenance =
  | 'observed' | 'derived' | 'estimated' | 'unknown' | 'conflicted';

type MeasurementOrigin =
  | 'provider_response' | 'codex_counter' | 'monitor_calculation'
  | 'tokenizer' | 'user_annotation' | 'unknown';

interface Metric<T> {
  value: T | null;
  provenance: Provenance;
  origin: MeasurementOrigin;
  sourceRefs: Id[];
  assumptions: string[];
  missingReason?: string;
}

interface UsageComponents {
  input: Metric<IntegerString>;
  cachedInput: Metric<IntegerString>;
  cacheWriteInput: Metric<IntegerString>;
  output: Metric<IntegerString>;
  reasoningOutput: Metric<IntegerString>;
  total: Metric<IntegerString>;
}

interface EvidenceRef {
  id: Id;
  workspaceId: Id;
  sourceStreamId: Id;
  generation: number;
  byteStart: IntegerString | null;
  byteEnd: IntegerString | null;
  lineStart: number | null;
  lineEnd: number | null;
  observationId: Id | null;
  contentFingerprint: string | null;
  retentionState: 'available' | 'metadata_only' | 'deleted' | 'source_missing';
  redactionPolicyId: Id;
}

interface NativeObservation {
  id: Id;
  workspaceId: Id;
  collectorId: Id;
  sourceStreamId: Id;
  sourceSequence: IntegerString;
  sourceTimestamp: string | null; // RFC3339 when known
  receivedAt: string;
  adapterId: string;
  adapterVersion: string;
  schemaFingerprint: string;
  nativeKind: string;
  evidenceRef: Id;
  payloadRef: Id | null; // local access-controlled content, never implicit upload
  originalFieldPresence: string[];
}
```

`sourceTimestamp: null` is legitimate. `receivedAt` is not a replacement for execution time. The validator must enforce nonnegative token components for ordinary usage entries; signed adjustments have a separate type and policy.

### 11.2 Execution and ledger entries

```ts
interface ExecutionIdentity {
  workspaceId: Id;
  originMachineId: Id | null;
  projectId: Id | null;
  runId: Id;
  agentId: Id | null;
  provider: string | null;
  threadId: string | null;
  sessionId: string | null;
  rootTurnId: string | null;
  turnId: string | null;
  responseId: string | null;
}

interface ModelAttribution {
  requestedModel: string | null;
  observedModel: string | null;
  providerRoute: string | null;
  serviceTier: string | null;
  quotaAlias: string | null;
  provenance: Provenance;
  evidenceRefs: Id[];
}

interface LedgerEntry {
  id: Id;
  accountingSetId: Id;
  identity: ExecutionIdentity;
  grain: 'response' | 'interval' | 'aggregate';
  scopeId: Id;
  accountingEpochId: Id | null;
  startAt: string | null;
  endAt: string | null;
  model: ModelAttribution;
  usage: UsageComponents;
  evidenceRefs: Id[];
  controlObservationRefs: Id[];
  replacedEntryRefs: Id[];
  selectionStatus: 'selected' | 'superseded' | 'quarantined';
  reconciliation: 'matched' | 'partial' | 'conflicted' | 'not_comparable';
  policyVersion: string;
}

interface Attempt {
  id: Id;
  identity: ExecutionIdentity;
  startedAt: string | null;
  completedAt: string | null;
  outcome: 'completed' | 'failed' | 'cancelled' | 'in_progress' | 'unknown';
  failureClass: string | null;
  usageEntryIds: Id[];
  usageState: 'known' | 'partial' | 'unknown';
  evidenceRefs: Id[];
}
```

A ledger entry's `scopeId` must have an explicit member/range definition. Aggregates and intervals that overlap selected response entries cannot coexist in the same sum. An accounting set is an immutable analysis revision, not a second source of consumption.

### 11.3 Context, tools, and findings

```ts
interface ContentOccurrence {
  id: Id;
  runId: Id;
  contextEpochId: Id | null;
  originKind: string;
  transportKind: string;
  lifecycleState: 'introduced' | 'retained' | 'summarized'
    | 'truncated' | 'removed' | 'unknown';
  evidenceRef: Id;
  parentOccurrenceIds: Id[];
  captureScope: 'source_original' | 'tool_payload' | 'client_request';
  tokenEstimate: Metric<IntegerString>;
  tokenizerId: string | null;
  tokenizerVersion: string | null;
  contentFingerprint: string | null;
  isCompleteCapture: boolean;
}

interface RequestContentLink {
  ledgerEntryId: Id;
  occurrenceId: Id;
  inclusion: 'observed_client_manifest' | 'estimated' | 'unknown';
  tokenContribution: Metric<IntegerString>;
  cacheAllocation: Metric<IntegerString>;
  evidenceRefs: Id[];
}

interface ToolInvocation {
  id: Id;
  identity: ExecutionIdentity;
  namespace: string;
  providerCallId: string | null;
  toolName: string;
  startedAt: string | null;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  inputEvidenceRefs: Id[];
  outputEvidenceRefs: Id[];
  outputOccurrenceIds: Id[];
  pairedBy: 'provider_id' | 'heuristic' | 'unpaired';
}

interface Finding {
  id: Id;
  revision: number;
  runId: Id;
  detectorId: string;
  detectorVersion: string;
  severity: 'info' | 'warning' | 'high';
  confidence: 'low' | 'medium' | 'high'; // ordinal rubric, not a probability
  title: string;
  observedFacts: string[];
  hypotheses: string[];
  alternativeExplanations: string[];
  evidenceRefs: Id[];
  associatedLedgerEntryIds: Id[];
  associatedUsageLabel: 'associated_not_causal';
  estimatedDuplicatePayloadTokens: Metric<IntegerString>;
  avoidableTokens: Metric<IntegerString>; // usually unknown outside experiments
  recommendations: string[];
  suppressionReasons: string[];
  lifecycle: 'open' | 'acknowledged' | 'intentional' | 'dismissed' | 'resolved';
}
```

### 11.4 Additional required records

| Record | Minimum fields |
|---|---|
| `CapabilitySnapshot` | Source, adapter/schema version, field/event capabilities, sample refs, time, limitations |
| `ContextEpoch` | Run/agent, boundary event, boundary type, supported predecessors/successors |
| `Compaction` | Identity, explicit event refs, start/end, trigger, usage links, context epochs |
| `TaskContract` | Objective, scope, acceptance definition, environment, revision, author |
| `OutcomeEvidence` | Task, result, verification source, artifact refs, time, contract revision |
| `FindingAnnotation` | Finding revision, user choice, reason, timestamp, suppression scope |
| `PriceSnapshot` | Provider/model, rates/currency, source, effective dates, tiers/thresholds, digest |
| `Experiment` / `Trial` | Task contract, variant, environment/config digests, observed run, result, exclusions |
| `SyncBatch` | Device/workspace, sequence range, schema version, digest, acknowledgment state |
| `RetentionTombstone` | Scope/object, policy action, time, sync generation, reimport suppression |
| `AuditEvent` | Actor/device, approved operation, scoped target, outcome, time; no content bodies |

## 12. Storage design, retention, and migrations

### 12.1 Storage layers

1. **Observation store:** Immutable metadata and source references for audit/reparse.
2. **Canonical accounting:** Selected ledger entries, control totals, overlaps, and revisions.
3. **Content/evidence index:** Permitted excerpts, fingerprints, source pointers, transformations.
4. **Read models:** Indexed materializations for charts, queries, and detection.
5. **User state:** Settings, annotations, experiment definitions, retention choices.

Raw Codex files remain owned by Codex. Monitor retention/deletion never edits them.

### 12.2 Logical tables and keys

| Table | Key / important constraints | Principal indexes |
|---|---|---|
| `workspaces` | `workspace_id` | none required |
| `machines` | `(workspace_id, machine_id)` | status/last_seen |
| `source_streams` | Stable source ID; explicit replica/origin relationship | workspace, machine, harness |
| `source_generations` | `(source_id, generation)` with committed offset | source, active |
| `observations` | Source/generation/offset or supported event sequence; payload digest | source sequence, kind, timestamp |
| `capabilities` | Source + adapter/schema revision | source, observed_at |
| `runs`, `agents`, `turns` | Workspace-scoped identities, nullable provider IDs | project/time, parent_agent, provider IDs |
| `attempts` | Internal attempt ID; nullable supported response identity | run, turn, response |
| `accounting_sets` | Immutable policy revision + source watermark | active view per workspace |
| `ledger_entries` | Entry ID, grain, scope, status, component counts/presence | accounting set/run/model/time |
| `ledger_evidence` | `(entry_id, observation_id, relation)` | observation_id |
| `scope_memberships` | Entry/response membership or source coverage range | scope, member, range |
| `usage_controls` | Cumulative or aggregate observation with explicit scope | scope, semantic sequence |
| `evidence` | ID, source pointer, retention state, policy | source/range |
| `content_occurrences` | ID, origin/transport, capture scope, digest | run, digest, context epoch |
| `request_content_links` | Entry + occurrence + inclusion evidence | occurrence, entry |
| `tool_invocations` | Workspace/provider/call namespace + internal identity | run, tool, provider_call_id |
| `context_epochs`, `compactions` | Explicit boundaries where supported | run/agent/time |
| `findings`, `finding_evidence` | Detector version + stable incident key + revision | run, severity, lifecycle |
| `finding_usage` | Unique finding/ledger membership | ledger_entry_id |
| `annotations` | Append-only user decisions | finding, task, time |
| `task_contracts`, `outcomes` | Contract revision and evidence-bound result | task, status |
| `price_snapshots` | Immutable digest, applicability metadata | model/provider/effective dates |
| `experiments`, `trials` | Trial IDs never overwritten by reruns | experiment, variant, outcome |
| `sync_batches`, `tombstones`, `audit_events` | Workspace-scoped identities | sequence, target, time |

### 12.3 Mandatory database invariants

- Foreign keys enforce workspace boundaries and evidence relationships.
- A selected ordinary usage entry cannot contain negative token components.
- Null/presence/provenance information survives migrations and exports.
- Response identity uniqueness is enforced only within its validated namespace and execution scope.
- Overlap validation prevents aggregates plus their members from contributing to the same total.
- Ledger revisions are atomically activated; readers never see half of a reconciliation update.
- Ingestion commits observations and source cursor together.
- Annotations survive reparse by stable incident/evidence mapping, or are explicitly marked orphaned.
- Deletion updates indexes, retained excerpts, exports managed by the app, and sync tombstones consistently.
- Database errors cause visible degraded mode, not a reset to an empty “zero usage” view.

### 12.4 Retention defaults to implement and expose

These are proposed defaults, configurable per workspace/project:

| Data class | Default |
|---|---|
| Raw source-file copies | Disabled |
| Indexed normalized event metadata | 30 days |
| Redacted excerpts retained independently of source | 7 days |
| Usage aggregates/ledger metadata and findings | 180 days |
| Remote sync spool | Bounded by 7 days or 256 MiB, whichever is reached first |
| External-AI request bodies | Not retained by the monitor by default |
| Local content search | Opt-in for the selected project |

When the spool limit is reached, emit a data-gap warning and record the dropped sequence range; do not consume unlimited disk. Users requiring longer full-history analysis must choose a longer policy and see its storage/privacy impact.

“Delete from monitor” must explain that original Codex logs, user-exported copies, and other recipients may still exist. Do not promise forensic erasure from SSDs/backups. Support reimport exclusion and deletion propagation within enrolled monitor components.

### 12.5 Migration procedure

Back up monitor-owned metadata using a consistent database snapshot; validate schema version; migrate transactionally where supported; run invariant checks; activate only after successful verification. On failure, retain the previous usable database and report the error. Never migrate by deleting and silently recreating user history.

## 13. Query, IPC, synchronization, and optional MCP contracts

These are new **monitor APIs**, not Codex API names. Local desktop access uses a narrow IPC bridge. A remote receiver may expose an equivalent authenticated HTTP contract after M5 security gates.

### 13.1 Read/query surface

| Method | Input | Output / constraints |
|---|---|---|
| `sources.inspect` | Authorized source ID | Capabilities, health, version, no secret bodies |
| `runs.list` | Project/machine/date filters, cursor, limit | Summaries and coverage; default limit 50, max 200 |
| `run.read` | Run ID, accounting revision | Totals, topology, coverage, freshness |
| `usage.list` | Run/agent/model, grain, cursor | Selected ledger rows with provenance |
| `usage.explainTotal` | Read-model ID/revision | Membership, controls, exclusions, gaps |
| `events.page` | Run, source/time filter, cursor | Bounded metadata/excerpts, explicit gaps |
| `findings.list` | Run/type/status filters | Evidence-backed findings and revisions |
| `finding.read` | Finding ID/revision | Facts, hypotheses, evidence, recommendations |
| `evidence.read` | Evidence ID, permitted view | Bounded excerpt or denied/unavailable state |
| `context.read` | Entry/run ID | Attribution tier, occurrences, estimates, discrepancies |
| `experiments.read` | Experiment ID | All trials, outcome and resource comparisons |
| `reports.preview` | Scope, format, redaction policy | Redacted preview, coverage, proposed destination |
| `health.read` | Workspace scope | Lag, gaps, failures, version and resource metrics |

A cursor must include or bind to its accounting/read-model revision. A stale cursor returns `REVISION_CHANGED` with a restart hint rather than mixing different revisions silently.

### 13.2 User-authorized monitor mutations

Allow only explicit, validated actions: source enrollment/removal, policy updates, finding annotations, report export, reindex request, experiment definition, and deletion. These mutate monitor-owned state, not Codex tasks or source logs.

Require an explicit action for remote detail authorization, external AI analysis, benchmark execution, and any saved configuration suggestion.

### 13.3 Sync envelope

A proposed minimal metadata batch:

```json
{
  "schemaVersion": "1",
  "workspaceId": "ws_demo",
  "deviceId": "win_demo",
  "batchId": "batch_demo_42",
  "sequenceStart": "4200",
  "sequenceEnd": "4299",
  "createdAt": "2026-10-12T07:00:00Z",
  "payloadDigest": "synthetic-example-digest",
  "redactionPolicyId": "metadata-only-v1",
  "events": []
}
```

This is a schema illustration, not a usable signed batch. Authentication belongs to the validated transport/session; it is not established by trusting `deviceId` in JSON. Bind the batch digest to the authenticated device, workspace, and sequence range.

**Receiver behavior:** Validate version, authorization, payload limits, digest and sequence; insert idempotently; acknowledge the highest durably contiguous sequence; report rejected ranges. A repeated `batchId` with a different digest is a conflict/security event, not an update.

Remote content retrieval uses evidence IDs, not caller-supplied paths. Validate the evidence's workspace/device/source authorization before reading. Content permission expires and is auditable.

### 13.4 Errors and limits

Required error classes:

```text
UNAUTHORIZED
FORBIDDEN_SOURCE
CONTENT_NOT_AUTHORIZED
SOURCE_OFFLINE
EVIDENCE_UNAVAILABLE
UNSUPPORTED_SCHEMA
PARTIAL_COVERAGE
ACCOUNTING_CONFLICT
REVISION_CHANGED
INVALID_CURSOR
PAYLOAD_TOO_LARGE
RATE_LIMITED
STORAGE_UNAVAILABLE
```

Default remote ingestion limit: 1 MiB uncompressed metadata per batch and 1,000 events; reject decompression bombs and oversized nested structures. Query timeouts and cancellation are mandatory. Never expose arbitrary SQL or arbitrary filesystem path resolution through IPC/HTTP/MCP.

### 13.5 Optional MCP tools

Expose only bounded read methods such as `get_run_summary`, `list_findings`, `get_finding_evidence`, and `get_redacted_report`. Tool output must include provenance and truncation. It must not include instructions requiring the receiving agent to alter files or disclose secrets.

Do not turn the monitor into a general-purpose computer-control server. A separate future control plane would need its own specification and authorization model.

## 14. User interface requirements

No new UI framework is required. Extend the existing graph, sidebar, trace tab, and token-detail patterns. Interface labels must distinguish what is known from what is inferred.

### 14.1 Screen inventory

| Screen | Main questions | Required content |
|---|---|---|
| Overview | What should I investigate? | Observed usage, coverage, active sources, recent findings, explicit unknowns |
| Run Inspector | What happened in this task? | Existing agent graph + task contract, outcomes, exclusive/inclusive toggle |
| Usage Ledger | Which records make up the total? | Responses/intervals/aggregate badges, components, conflicts, source links |
| Context Explorer | What visible content contributed? | Origin/transport/age facets, capture scope, estimates, reconciliation gap |
| Tool & File Explorer | Which operations introduced/repeated content? | Paired invocations, output size, fingerprints, findings |
| Execution Timeline | When did it happen? | Agent swimlanes, request/interval usage, tools, retries, compaction, gaps |
| Findings Inbox | What may be avoidable? | Facts, hypotheses, alternatives, evidence, annotations and cooldown state |
| Agent Outcomes | Did the work succeed? | Task criteria, verified/unverified result, evidence, resource distributions |
| Experiments | Did a change help? | Complete trials, quality first, distributions, confounders, chosen variant |
| Machines & Sources | What is being observed? | Enrollment, capabilities, freshness, offline gaps, metadata/content permissions |
| Data Quality | Can I trust this view? | Parse coverage, missing fields, conflicts, policy versions, reindex status |
| Settings & Privacy | What is stored/shared? | Retention, redaction, exports, AI consent, prices, budgets, integrations |

### 14.2 Required interaction path

From any run total, the user must be able to open its ledger membership. From any finding, open its evidence. From any estimated number, open assumptions/tokenizer/capture scope. From any unpriced or unknown number, open the reason and the missing field. No dead-end “AI says this is waste” cards.

### 14.3 Representative run summary

```text
Run: Fix parser behavior
Observed/derived usage: 57,500 tokens
  Input: 53,000
    Cached input included: 36,000
  Output: 4,500
    Reasoning included: 2,700

Evidence:
  3 identified responses with final usage
  All discovered records processed
  Complete request population: not independently established
  Server-side context composition: unavailable

Findings:
  Repeated captured file content: 1 candidate
  Similar failed test attempts: 1 candidate
  Avoidable token savings: not measured

[Explain total] [Open timeline] [Inspect findings] [Export redacted report]
```

All figures above are synthetic and use the arithmetic in Section 5.

### 14.4 Wording rules

Use “potentially redundant,” “associated usage,” and “visible context estimate.” Reserve “measured savings” for eligible experiments. Use “No evidence captured” instead of “Did not happen.” Use “Unpriced” instead of `$0.00` when prices are unavailable.

Never use “Reasoning text” for unavailable hidden reasoning. Show a numeric reasoning component only when the source supports it; any accessible summaries are labeled summaries.

### 14.5 Accessibility, localization, and large runs

Support keyboard navigation, readable focus states, searchable tables, accessible chart summaries, and explanations not dependent on color alone. Keep text and numeric columns readable without horizontal squeezing. Default language can follow the application setting; include English and Traditional Chinese terminology.

Use virtualized rows and bounded rendering. Allow users to pause live auto-scroll while inspecting evidence; resuming should not lose their selected event. Preserve filter state when switching between a finding and its source trace.

## 15. Security design and threat model

Security requirements apply to all milestones, not just to remote synchronization.

### 15.1 Threats and mandatory controls

| Threat | Example | Required control |
|---|---|---|
| Malicious trace content | A tool result contains HTML/script or instructions to export keys | Treat as data; escape output; no trace-driven execution; bounded advisor bundle |
| Excessive filesystem access | A caller supplies `../../` or a symlink to an excluded directory | Evidence-ID access only; canonical-root authorization and symlink policy |
| Credential collection | A broad `~/.codex` copy includes authentication files | Read explicit trace roots only; deny sensitive paths and secret classes |
| Renderer compromise | A trace attempts to invoke privileged Node functions | Context isolation, narrow validated bridge, no arbitrary Node/filesystem access |
| Unauthorized remote device | A forged batch claims another machine's ID | Authenticate device keys, bind identity to workspace, revoke enrollment |
| Replay or changed payload | Same batch/event identity arrives again or with altered data | Idempotency plus digest conflict detection; no silent overwrite |
| Sensitive metadata leakage | Project names, paths, queries, or short-content hashes reveal information | Allowlisted metadata, pseudonymous labels, workspace-scoped keyed fingerprints |
| Resource exhaustion | Oversized lines, nested JSON, decompression bombs, millions of nodes | Size/depth/batch limits, streaming, quotas, virtualized queries |
| Misleading findings | A trace says “all tests passed” without evidence | Outcome provenance and acceptance-artifact verification |
| Cross-workspace mixing | Same provider IDs appear in different workspaces | Composite security keys and workspace-scoped queries |
| Insecure updates | Unreviewed binary or compromised dependency | Pinned dependencies, reviewed build pipeline, hashes/signatures where available |
| Unsafe export | CSV formulas or executable HTML from source text | Spreadsheet-cell escaping, HTML sanitization, content policy and preview |
| AI data exfiltration | Optional advisor is prompted to request unrelated files | No autonomous filesystem/tool permissions; fixed schema and strict allowlist |

### 15.2 Permission tiers

| Tier | Access |
|---|---|
| L0 | Aggregate metadata and usage; no retained text search |
| L1 | Locally permitted trace details and redacted excerpts |
| L2 | Enrolled-device metadata synchronization |
| L3 | Individually authorized remote evidence details |
| L4 | User-approved external AI explanation bundle |
| L5 | Separate, explicitly authorized benchmark execution in an isolated workspace |

Higher tiers are not implied by lower ones. Enrolling a machine for counters does not authorize raw code synchronization. An advisor permission does not authorize benchmark execution or editing a repository.

### 15.3 Content minimization

Apply local detection before redaction when necessary, then emit only approved evidence summaries. Preserve a private local mapping for opaque path/content IDs. Cross-machine duplicate detection may share a workspace-scoped equality fingerprint only with consent; a fingerprint is not inherently anonymous.

Redaction is defense in depth, not a guarantee that every secret will be recognized. The default external payload should use structured metadata and short selected excerpts, with a user-visible preview.

### 15.4 Execution isolation

The passive collector does not execute repository commands. Benchmark execution, when later implemented, uses a separate permissioned runner, fixed task setup, resource limits, explicit network policy, and no default access to production credentials. Never run commands found in trace contents as a way to “reproduce” an incident without review.

## 16. Detector logic, scoring, and optimization claims

### 16.1 Deterministic first

Ship reproducible rules before AI interpretation. Each detector must declare its input capabilities, rule version, candidate-generation logic, threshold defaults, suppression rules, evidence requirements, and acceptance fixtures.

A detector that cannot establish the required input state should return `insufficient_evidence`, not “no problem found.”

### 16.2 Confidence rubric

| Level | Meaning |
|---|---|
| Low | Similarity or time association exists, but important state/identity evidence is missing. |
| Medium | Several direct observations support the pattern; plausible alternative explanations remain unresolved. |
| High | Direct repeated observations and relevant state evidence support the specific pattern, with key alternatives checked. |

High confidence in repeated content is not high confidence in avoidable cost. Keep `pattern confidence` separate from `savings evidence`.

### 16.3 Incident formation

Construct stable incident keys from detector version, run/agent scope, target/content/error fingerprint, and the relevant context window. New matching observations update the incident revision rather than creating uncontrolled duplicate findings.

Suppressions have a scope and expiry: one finding, one task, one project rule, or a declared recurring verification step. Preserve the underlying observations and let users inspect suppressed findings.

### 16.4 Relationship is not causation

Use these labels consistently:

```text
Observed payload size: directly captured bytes or tokenizer estimate.
Associated usage: union of eligible ledger entries in a linked scope/interval.
Estimated exposure: modeled input occurrences with inclusion assumptions.
Potential reduction scenario: hypothetical change, not an observed outcome.
Measured improvement: eligible before/after trial result with quality preserved.
```

Never estimate cost attributable to a tool by multiplying its share of visible text by the whole request bill and presenting the result as exact. A proportional allocation may be offered only as an explicitly named scenario, disabled by default.

### 16.5 Measuring detector quality

Maintain a reviewed fixture corpus containing both true candidates and intentional repetitions. Report precision and recall on that corpus with its size and labeling policy. Synthetic test performance is not evidence of production accuracy.

User annotations should improve rule evaluation and configuration. Do not silently train external models on private traces or convert user feedback into undisclosed uploads.

## 17. Benchmark protocol and decision rules

### 17.1 Trial specification

Each benchmark must record:

```text
task_id and acceptance_contract_revision
repository_commit plus dirty-worktree snapshot/digest when applicable
input_dataset_digest and dependency/toolchain versions
OS/architecture and relevant resource limits
Codex/client version and adapter/policy version
requested model, observed model, reasoning configuration, routing/tier
instruction and tool-policy revision
variant and changed variable(s)
trial order, start/end timestamps, run/response identities
cache condition: observed / controlled / uncontrolled / unknown
network/service dependencies and known interruptions
quality outcome, usage completeness, and all exclusion reasons
```

Do not copy credential-bearing environment variables into the experiment record.

### 17.2 Comparison rules

Use the same task and acceptance criteria for each paired comparison. Keep setup differences explicit. Prefer several paired trials for each task rather than drawing a general conclusion from one run; three pairs may be used as an initial exploratory minimum, not as a statistical adequacy guarantee.

Report pass rate, eligible trial count, total resources including failures, medians/ranges, and paired differences where meaningful. Add confidence intervals only when sample size and assumptions justify them. State when provider variability, caching, or task changes limit causal interpretation.

### 17.3 Selecting a variant

A variant is recommended only if it meets the defined quality requirement and the resource improvement is relevant to the chosen objective. Do not trade away required tests, independent review, or correctness merely to reduce tokens.

A model change, instruction change, and lower tool-output limit introduced together can be assessed as a combined policy. It cannot prove which single change caused the result.

### 17.4 Savings labels

A trial may show fewer input tokens, a different cache share, or lower API-equivalent cost. These are separate outcomes. A reduction in API-equivalent cost does not establish a subscription refund or a proportional quota benefit.

## 18. Performance and operational targets

The following are **proposed acceptance targets**, not measured performance of the current upstream or this unimplemented extension.

### 18.1 Reference workload

Use a documented benchmark host with four logical CPU cores, 16 GiB RAM, and local SSD storage. Use synthetic JSONL with a recorded size distribution, including a median record around 1 KiB, large bounded records, and malformed edge cases. Test the headless collector separately on Linux ARM64 with a constrained memory budget.

| Operation | Initial target |
|---|---|
| Local new-event visibility | p95 within 2 seconds at 100 valid events/second after indexing is current |
| Indexed 200-row timeline page | p95 within 300 ms on the reference dataset |
| Run summary query | p95 within 500 ms on the reference dataset |
| Incremental collector peak RSS | At most 256 MiB in the headless reference workload |
| Idle collector CPU | Average below 1% of one logical core, excluding initial scans/reindex |
| Large-file import | Stream one million synthetic records without memory proportional to file size |
| Renderer memory | Bounded under a documented 10,000-event selected-run scenario; initial target below 1 GiB |
| Restart correctness | No lost committed observation and no duplicate canonical usage after replay |
| Unchanged-file handling | No repeated full-file reads on ordinary refresh |

Targets may be revised through measured architecture decisions. The release report must publish actual hardware, workload, observed results, and any unmet targets rather than claiming success from code inspection.

### 18.2 Backpressure and failure behavior

Pause lower-priority enrichment before losing usage metadata. Bound parsing queues, DB transactions, detector work, renderer updates, and sync buffers independently. Support cancellation for imports/reindex. A stopped enrichment task must not block core accounting.

Keep the last valid read model on transient failures. Distinguish `current`, `catching_up`, `stale`, `partial`, and `failed`. Storage-full and permission errors require visible user action; they must not be retried in a tight loop.

## 19. Delivery milestones and implementation backlog

### M0 — Baseline audit and compatibility contract

**Deliver:** Pinned upstream SHA; license/permission review status; unchanged upstream test results; platform/runtime inventory; adapter mapping draft; synthetic fixture suite; source capability screen skeleton.

**Exit gate:** Existing functionality has a recorded baseline. At least one legacy usage fixture and one supported richer usage fixture are defined. Richer live Desktop support remains conditional until demonstrated on the user's approved installation.

**Do not:** Rewrite the UI or advertise full request attribution before the source contracts exist.

### M1 — Trustworthy single-machine accounting and history

**Deliver:** F01, F02, F10, F18 core; F17 safeguards; immutable observations, cursor-safe ingestion, canonical ledger, coverage, paginated trace, reconciliation, and restart/replay tests.

**Exit gate:** Golden totals reconcile; reimport/restart is idempotent; missing data is explicit; older retained detail is navigable; upstream graph/trace behavior is preserved.

**Product value:** The user can determine how much was observed and audit exactly which records form the total.

### M2 — Practical diagnosis and visible-content estimates

**Deliver:** F03 passive-mode attribution, F04-F07, initial F11, F15 ledger-backed analytics, F16 redacted report.

**Exit gate:** Every finding has source evidence and limitations. Repetition is not labeled confirmed waste. Tool-output size and subsequent input exposure are separate. Detector negative fixtures pass.

**Product value:** The user can identify suspicious phases and operations without manually scanning the entire run.

### M3 — Agent outcomes and optimization workflow

**Deliver:** F08-F09, full finding feedback, F12 deterministic advisor and optional consent-based AI explanation, richer F15/F16, optional read-only query/MCP integration.

**Exit gate:** Outcomes require evidence; recommendations preserve quality constraints; advisor usage is separately metered; external analysis is disabled by default.

### M4 — Controlled comparisons

**Deliver:** F13, task contracts, experiment/trial persistence, quality-first comparisons, isolated opt-in benchmark runner or approved-run import.

**Exit gate:** Failed trials remain visible; compared scopes are compatible; a cheaper failing variant cannot win; uncontrolled variables are reported.

### M5 — Multi-machine operation

**Deliver:** F14, headless ARM64 collector, macOS/Windows integration, device enrollment/revocation, durable metadata sync, clock/freshness indicators, optional approved evidence retrieval.

**Exit gate:** Offline replay does not double-count; identity conflicts are surfaced; metadata-only privacy tests pass; no display server is required on the VPS.

### M6 — Conditional deeper integrations

**Deliver only where supported:** F19 account summaries/quotas, F20 context manifests, and improved response-level correlation from supported current protocols.

**Exit gate:** Each integration has real compatible fixtures, explicit authorization, accurate scope labels, and graceful unavailable states. No private traffic interception or guessed credentials.

### 19.1 Suggested work packages

| Package | Scope | Dependency |
|---|---|---|
| W01 | Baseline, permissions, fixtures, upstream regression inventory | none |
| W02 | Provenance/identity contracts and runtime validators | W01 |
| W03 | Durable observation store and source cursor | W02 |
| W04 | Legacy/rich adapters and capability detector | W01-W03 |
| W05 | Canonical ledger, overlap resolver, reconciliation | W04 |
| W06 | Paginated timeline/evidence queries and read models | W03-W05 |
| W07 | Coverage and data-quality UI | W04-W06 |
| W08 | Content-origin taxonomy and tokenizer abstraction | W04-W06 |
| W09 | Tool pairing and truncation/capture-scope tracking | W08 |
| W10 | Repeated-read and retry detectors | W05, W09 |
| W11 | Compaction/context-epoch analysis | W05, W08 |
| W12 | Findings, feedback, advisory budgets, and notifications | W10-W11 |
| W13 | Pricing/cache/project/model auditability | W05 |
| W14 | Redacted reporting and bounded read API | W06, W12-W13 |
| W15 | Cross-agent comparison and verified outcomes | W06, W09, W12 |
| W16 | Deterministic advisor and opt-in AI explanation | W14-W15 |
| W17 | Benchmark trials and comparison engine | W15-W16 |
| W18 | Extract headless collector and platform builds | W03-W07 |
| W19 | Enrollment, sync, revocation, tombstones | W14, W18 |
| W20 | Conditional account and context-manifest adapters | W04-W05, M6 approval |

Parallel work may proceed only with clear module ownership and stable contracts. Keep one integration owner. Do not assume increasing the number of coding agents improves quality; avoid parallel modification of the same accounting or schema files.

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

## 21. Risks, limitations, and decision log

| Issue | Current position | Required resolution |
|---|---|---|
| Upstream commit not pinned during document preparation | Sources inspected on public `main`; no immutable build baseline claimed | Record SHA before coding and reassess the baseline matrix. |
| Reuse/redistribution permissions not established | Do not assume a particular license | Verify before publishing a derivative; do not make distribution claims. |
| Actual Desktop record availability | Not tested on the user's Mac/Windows installations | Inspect an approved sample locally; capability-gate unsupported detail. |
| Request usage may be incomplete | Per-response and aggregate evidence may differ | Preserve gaps, failed attempts, and reconciliation controls. |
| Full server-side input is unavailable | Passive and client manifests have limited scope | Show client-visible estimates and unknowns; no invented prompt breakdown. |
| Tool-level causal savings | Not established by adjacent usage counters | Use controlled experiments or labeled scenarios. |
| Cache span allocation | Usually not present in the proposed passive evidence | Do not allocate per-file cache as an exact fact. |
| Compaction-specific usage | May not have a separable identity | Show unknown overhead and avoid parent/child double counting. |
| Forked/copied logs | Same historical data may appear in several places | Origin-aware identity and explicit uncertainty. |
| Multiple agent tasks share a workspace | Diffs and tests may not have clear ownership | Associate only with supported evidence; keep task outcomes unverified where necessary. |
| Native dependency packaging | Electron and headless runtimes may need different builds | Platform smoke tests before advertising support. |
| Long-history privacy/storage | More retained detail increases exposure and disk use | Configurable retention; transparent gaps; raw copies off by default. |
| Detector false positives | Necessary verification resembles repeated work | Evidence, task intent, suppression, and evaluation corpus. |
| Automatic AI explanation | Can hallucinate or disclose sensitive text | Opt-in minimal bundles, claim checks, no tool privileges, separate usage meter. |
| Account versus local totals | Scope, timing, and source population may differ | Display separately until definitions are reconciled. |
| Future upstream overlap | Upstream may add similar features | Prefer integration/reuse over duplicate implementations. |

### 21.1 Decisions already made in this proposal

- Preserve the existing Electron/React experience.
- Codex is the primary enhancement target; preserve other providers' working behavior.
- Local-first, read-only collection is the default.
- SQLite persistence and deterministic diagnostics precede optional AI analysis.
- Keep request and interval accounting distinct.
- Keep accuracy/provenance visible in UI and export.
- Implement multi-machine support only after single-machine identity is reliable.
- Do not offer autonomous “fix my token usage” actions in this scope.
- Do not use token reduction as the sole success criterion.

### 21.2 Decisions to finalize during implementation

Select a reviewed SQLite binding and tokenizer strategy; establish supported Codex schema fingerprints; choose an authenticated remote transport implementation; confirm upstream integration permissions; measure performance on actual hardware; and set detector thresholds from reviewed examples.

These are bounded engineering decisions. They do not justify replacing the product with an unrelated platform or postponing the useful single-machine ledger.

## 22. Proposed configuration example

This YAML is a **monitor configuration proposal**. It is not an existing Agent Monitor or Codex configuration file. Do not paste it into Codex's own settings.

```yaml
schema_version: "1"
workspace:
  id: "local-default"
  ui_language: "zh-Hant"
  display_timezone: "system"

sources:
  - id: "codex-local"
    harness: "codex"
    mode: "passive_logs"
    root: "auto"
    read_only: true
    include_projects: []
    exclude_projects: []
    discover_extra_roots: false

accounting:
  preserve_unknown_fields: true
  canonical_policy: "non-overlapping-ledger-v1"
  fallback_grain: "interval_or_aggregate"
  never_infer_request_count_from_turn_count: true
  conflicts: "quarantine_affected_scope"

context:
  attribution_enabled: true
  tokenizer_mode: "supported_or_labeled_approximation"
  per_content_cache_allocation: "unknown_unless_observed"
  instrumented_manifests: false

privacy:
  raw_source_copies: false
  retained_excerpts: "redacted"
  local_full_text_search: false
  telemetry: false
  sync_policy: "metadata_only"
  remote_content_access: "explicit_per_source_approval"

retention:
  event_metadata_days: 30
  redacted_excerpts_days: 7
  usage_metadata_days: 180
  suppress_reimport_after_user_deletion: true

diagnostics:
  repeated_read:
    enabled: true
    minimum_identical_captures: 3
    minimum_estimated_duplicate_payload_tokens: 2000
  retry_loop:
    enabled: true
    minimum_comparable_failures: 3
    window_seconds: 600
    unknown_state_reduces_confidence: true
  compaction_burst:
    enabled: false
    minimum_explicit_events: 3
    window_seconds: 1800
  cross_agent_overlap:
    enabled: false
    respect_independent_verification: true

alerts:
  enabled: true
  suppress_historical_import_notifications: true
  minimum_incident_update_seconds: 300
  automatic_codex_actions: false

budgets:
  run_total_tokens: null
  run_uncached_input_tokens: null
  run_elapsed_seconds: null
  api_equivalent_usd: null

advisor:
  deterministic_enabled: true
  external_ai_enabled: false
  require_payload_preview: true
  account_usage_separately: true
  allow_project_mutations: false

benchmarks:
  execution_enabled: false
  require_isolated_workspace: true
  require_quality_gate: true
  retain_failed_trials: true

remote:
  enabled: false
  transport: "authenticated_encrypted"
  require_device_enrollment: true
  payload_mode: "metadata_only"
  max_batch_bytes: 1048576
  max_batch_events: 1000
  spool_max_mib: 256
  spool_max_days: 7

integrations:
  readonly_mcp_enabled: false
  account_summary_enabled: false
  account_write_methods_enabled: false
```

Configuration validation must reject unknown security-sensitive options rather than silently ignoring them. Permission escalation always requires a user-facing confirmation, even when configuration is edited externally.

## 23. Synthetic end-to-end walkthrough

### 23.1 Scenario

A user asks Codex to correct a parser. A local collector sees a root agent, several tools, and three identified completed responses. The underlying model usage matches the synthetic table in Section 5.

The collector also sees two reads with the same filename, a failed test, a modified parser, and another failed test. One read has incomplete captured output. The failures are not yet known to have the same cause.

### 23.2 Correct analysis

The ledger totals 57,500 tokens, including 53,000 input and 4,500 output. It preserves 36,000 cached input and 2,700 reasoning as subsets. It does not add these subsets to the total.

The monitor shows three **observed completed responses**, not a guarantee that the source captured every failed or hidden request. A filename appearing twice does not satisfy the proposed three-identical-capture detector. The partial read is not proof of unchanged full-file content.

The retry detector shows comparable evidence only after examining normalized errors and intervening changes. It does not declare a useless loop from the word “failed” twice.

The task outcome remains unverified until acceptance evidence is present. No savings estimate is produced merely because the run looks expensive.

### 23.3 Additional isolated detector example

In a separate synthetic run, five tool calls return the same fully captured file range, within one context epoch, with an estimated 4,500 tokens per result. The first copy is not duplicate emitted content. The remaining four copies imply an estimated 18,000 duplicate **payload** tokens.

That candidate does not establish 18,000 wasted input tokens. The detector still checks intentional verification, file revision evidence, truncation, inclusion in later requests, and cache uncertainty. Its suggestion is to test a narrower read policy, not to announce a refund.

### 23.4 Controlled follow-up example

Suppose a benchmark later runs the original and revised policies against the same acceptance task. All eligible trials, including failures, are retained. The report first checks quality, then compares observed input/output, cache share, and time.

Only after that evidence exists may the product state a measured resource improvement for that experiment. Generalizing to all future tasks requires a broader evaluated task suite.

## 24. Coding-agent handoff and working instructions

### 24.1 Reading guide

Do not repeatedly inject this entire specification into every model request. Start with Sections 1-6, the active milestone in Section 19, and this section. Load the relevant feature and contract sections as needed. Maintain a compact implementation state file that links to requirement IDs instead of copying all requirements into each handoff.

### 24.2 Bootstrap prompt

```text
You are implementing the Codex Token Inspector extension described in
Agent_Monitor_Codex_Token_Inspector_Spec.md.

Work in the user-authorized Agent Monitor checkout or explicitly designated
extension repository. Do not modify unrelated projects or private source logs.

First complete M0:
1. Inspect the working tree without deleting, resetting, or overwriting changes.
2. Record the upstream commit and confirm reuse/distribution permission status.
3. Read the actual architecture, adapters, shared types, tests, and package scripts.
4. Run the existing relevant tests and record actual results.
5. Verify source capability mappings using synthetic or approved redacted fixtures.
6. Compare the baseline matrix with the pinned code and update any changed facts.

Then implement M1 as a narrow vertical slice:
- authorized source discovery;
- durable cursor and immutable observation ingestion;
- versioned normalization with field-presence/provenance;
- non-overlapping response/interval/aggregate ledger;
- reconciliation and missing/conflicted states;
- paginated retained history and an Explain Total UI;
- required privacy and replay/restart tests.

Do not implement all twenty features in one uncontrolled rewrite.
Preserve working upstream graph, trace, model, and other-provider behavior.
Do not claim exact per-request usage when only cumulative intervals exist.
Do not double-count caches, reasoning, parent aggregates, mirrored logs, or
inherited historical events. Do not fabricate missing context or savings.
Keep external AI, remote sync, account integrations, benchmark execution,
and context instrumentation disabled until their separate gates are met.

For every implementation increment:
- list requirement/test IDs covered;
- keep changes small and module ownership clear;
- run applicable tests and type checks;
- report actual commands/results and unresolved limitations;
- update STATE.md and the acceptance matrix;
- preserve user annotations and existing data during migrations.

If a capability is unavailable, implement a clear unsupported/partial state
and continue independent work. Do not bypass privacy or authorization to
make a feature appear complete.
```

### 24.3 Recommended implementation documents

These are future repository deliverables, not additional files created by this specification:

| File | Purpose |
|---|---|
| `STATE.md` | Current milestone, completed requirement IDs, tests, known blockers, next bounded step |
| `docs/BASELINE_AUDIT.md` | Pinned upstream, permission status, existing functionality, compatibility evidence |
| `docs/ADAPTER_CAPABILITIES.md` | Supported runtime/schema fixtures and field mappings |
| `docs/ACCOUNTING_RULES.md` | Canonical selection, deduplication, scopes, adjustments, reconciliation |
| `docs/SECURITY_AND_PRIVACY.md` | Permissions, data flow, retention, synchronization, threat model |
| `docs/ACCEPTANCE_MATRIX.md` | Requirement-to-test traceability and actual execution results |
| `docs/KNOWN_LIMITATIONS.md` | Unknown/unsupported capabilities and their user-visible behavior |
| `tests/fixtures/manifest.json` | Synthetic/approved fixture identities and expected results |

### 24.4 Change-management rules

Do not clear a branch, reset the working tree, replace upstream history, or publish a release merely because this document suggests an extension. Resolve implementation scope through the authorized repository/workflow. A specification is not approval to upload private traces or run paid experiments.

Record discovered upstream changes and adjust requirements by explicit decision, not by silently removing acceptance criteria to make tests pass.

## 25. Definition of done and traceability

### 25.1 Product-level completion

The proposed extension is complete only when the enabled milestones meet their gates. Conditional features may remain unavailable on some installations, but the unavailable state and compatibility evidence must be explicit.

A usable first release requires M0-M2. It does not need autonomous optimization, remote synchronization, account access, or full context manifests to provide value.

### 25.2 Release checklist

- [ ] Baseline SHA and permission status are recorded.
- [ ] Actual supported Codex/runtime fixtures are documented.
- [ ] Upstream functionality preserved by regression tests.
- [ ] Request, interval, aggregate, and context-estimate scopes remain distinct.
- [ ] Replays, mirrors, forks, caches, reasoning, and parent/child totals do not double-count.
- [ ] Unknown/conflicted data remains visible in UI and exports.
- [ ] Totals can be traced to retained source evidence and accounting revisions.
- [ ] Persistent history works within the explicit retention policy.
- [ ] Findings contain evidence, alternatives, and uncertainty; not automatic waste verdicts.
- [ ] Task quality is part of efficiency/benchmark conclusions.
- [ ] Advisor, sync, account integration, and benchmark execution require opt-in.
- [ ] Secrets/content are excluded from default remote metadata and notifications.
- [ ] Source logs and unrelated repositories remain unchanged.
- [ ] Platform, security, and resource tests have actual recorded outcomes.
- [ ] Reports identify their model/price/adapter/policy versions and limitations.
- [ ] Release notes distinguish implemented, experimental, conditional, and deferred functions.

### 25.3 Feature-to-delivery traceability

| Feature group | Requirement IDs | Primary verification |
|---|---|---|
| Trustworthy accounting and source coverage | F01-F02, F18 | T01-T21, T45, T48-T50 |
| Context and tool analysis | F03-F04, F20 | T22-T24, T47 |
| Repetition, retries, compaction | F05-F07 | T25-T32 |
| Multi-agent work and outcomes | F08-F09 | T16-T17, T27, T33-T34 |
| History and operational experience | F10-F11 | T18-T21, T35-T36, T50 |
| Optimization and experiments | F12-F13 | T35, T38-T40 |
| Remote collection and privacy | F14, F17 | T15, T38, T41-T44 |
| Cache/pricing and exports | F15-F16 | T07-T09, T37-T38, T49 |
| Account observation | F19 | T46 |

### 25.4 Final product promise

The product should say:

> “Here is the usage we observed, the evidence behind it, the operations associated with it, and the improvements worth testing.”

It must not say:

> “We know exactly where every hidden token went, and every repeated action was waste.”

## 26. Source register and verification notes

Sources below were consulted for the baseline on 2026-10-12. They are primary project documentation/source code or official Codex documentation. They establish selected existing behavior, not the existence or effectiveness of the proposed additions.

### S01 — Agent Monitor repository / README

`https://github.com/donvito/agent-monitor`

Supports the baseline description of local agent graphs, traces, agent/model usage, and documented default source locations. Do not use repository popularity as an accuracy or security guarantee.

### S02 — Agent Monitor usage documentation

`https://github.com/donvito/agent-monitor/blob/main/docs/usage.md`

Supports existing dashboard/trace navigation and token-detail behavior.

### S03 — Discovery and privacy

`https://github.com/donvito/agent-monitor/blob/main/docs/discovery-and-privacy.md`

Supports local discovery, configurable trace roots, source selection, and documented read-only/local privacy design.

### S04 — Development documentation

`https://github.com/donvito/agent-monitor/blob/main/docs/development.md`

Supports existing module layout, bounded live trace detail, whole-selected-file JSONL metric processing, build/test workflow, and packaging descriptions. A display limit is not proof that original source records were deleted.

### S05 — Shared application types

`https://raw.githubusercontent.com/donvito/agent-monitor/main/src/shared/types.ts`

Supports the important correction that trace entries already have single-request input/output usage fields, and the shared model contract treats cache/reasoning as included components.

### S06 — Codex trace adapter

`https://raw.githubusercontent.com/donvito/agent-monitor/main/src/traces/codex.ts`

Supports observed handling of `token_count`, cumulative/last usage, turn context, and tool call/result identifiers. Inspection of this file is not an exhaustive audit of every accounting path.

### S07 — Token pricing assumptions

`https://github.com/donvito/agent-monitor/blob/main/docs/token-pricing.md`

Supports existing API-equivalent cost disclaimers, rate snapshots, partial coverage, model attribution, and bounded chart assumptions. This specification deliberately does not reproduce current model prices or promise future price stability.

### S08 — Package/runtime definition

`https://raw.githubusercontent.com/donvito/agent-monitor/main/package.json`

Supports the observed Electron/React/TypeScript-oriented implementation and available package scripts. Dependency versions must be taken from the pinned implementation checkout, not guessed from this document.

### S09 — Public Codex protocol source

`https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/protocol.rs`

Relevant symbols inspected: `TokenUsage`, `TokenUsageRecord`, `TokenUsageInfo`, `TokenCountEvent`, and context-related usage helpers. Per-response records are described in source as best-effort; source definitions do not establish that every installed Desktop emits every record to accessible files.

### S10 — Official Codex App Server documentation

`https://developers.openai.com/codex/app-server`

The page resolved to `https://learn.chatgpt.com/docs/app-server` during review.

Relevant documented surfaces: `thread/tokenUsage/updated`, lifecycle/tool/collaboration items, `contextCompaction`, `account/usage/read`, and `account/rateLimits/read`. Actual method availability, authentication, and observable-instance scope must be verified before integration.

### Verification boundary

The specification was reviewed against public sources and internally checked for structure and example consistency. No live user session was ingested, no upstream binary was executed, no full upstream code audit was performed, and no release-ready implementation is represented by this file. Requirements, thresholds, architecture, and performance targets are original proposals for implementation and validation.

---

**End of specification.**
