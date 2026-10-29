# Observed experiments and reports

The experiment view imports actual collected runs. Its controlled local acceptance
module can execute explicitly approved trusted Node bundles; it does not initiate
paid model requests. See local-benchmark.md for execution boundaries and limitations. A task contract records the objective, acceptance
criteria and environment. Its optional protocol identifies the task suite, frozen
input/repository/acceptance revisions, changed variables, ordering and minimum
trial count. These are operator annotations, not automatic verification of files
or provider configuration.

Each imported trial retains its exact ledger revision, machine/run scope, outcome,
acceptance review, evidence IDs, configuration, pair/order/rerun relationship and
uncontrolled factors. Evidence must belong to that run and machine. Duplicate or
overlapping whole-run snapshots are rejected. Failed setup can be recorded without
a run, with unknown telemetry. Failures, cancellations and exclusions remain in
the population and resources; they cannot be hidden by retaining successful runs
only.

Resource snapshots contain token totals and known subtotals, uncached input where
available, the span of timed ledger observations, captured tool failures, retry
candidates, explicit compaction records and immutable historical API-equivalent
price estimates. The observed span is not necessarily complete task duration.
Remote metadata-only sources have unknown lifecycle metrics. Diagnostic limits,
source gaps and accounting conflicts remain explicit.

Variants are compared within their contract. Frozen conditions must match;
configuration, cache state and fixed settings must be comparable. Paired protocols
require the same complete pair population and unique execution orders. Multiple
changed variables and missing/truncated populations stay descriptive. An exploratory
candidate is ranked by median accepted tokens only after the quality/coverage gates
pass. This is not a causal, significance, monetary or overall-performance claim.

Distributions show sample/missing counts and min/median/max for tokens, uncached
input, observed span, failed tools, retry candidates, compaction records and each
priced currency. Medians use integer arithmetic, including even-population halves;
currency medians remain decimal-exact and currencies are never combined.

The paired-difference panel adds explicit reference/candidate selection and a
union of recorded Pair IDs. Missing/duplicated members stay visible with unknown
differences, and measured failed trials remain in descriptive distributions with
their quality state. It uses immutable snapshots, separate currencies and exact
signed medians; it does not change the original recommendation. JSON/Markdown/CSV
exports carry that selection, trial/ledger/price/calculation versions and the
existing privacy guards. See paired-comparison.md for the bounded verification.

## Reports

Analysis reports follow the selected live-ledger scope and include coverage,
freshness, analytics, price coverage, findings, alternatives, advice, outcome
snapshots, ledger membership, evidence references and limitations. Experiment
reports include every stored attempt for one selected contract, retaining each
trial's own import-time values/revision rather than replacing them with the latest
ledger. Whole-trial resources are never added to live-ledger totals.

Markdown and JSON support full reports. CSV supports ledger, findings or trial
tables. Spreadsheet formula prefixes are escaped. Markdown notes are escaped as
text; raw source instructions are not executable. HTML export is not enabled.
Task descriptions, environment notes, exclusion reasons and uncontrolled-factor
text are omitted by default; the operator can explicitly include their own notes
in the preview. Common secret patterns are redacted, but the preview remains the
review boundary before sharing. Raw Codex prompts, code, tool arguments/results,
paths, credentials and content fingerprints are excluded.

The native save operation writes exactly the frozen preview. The complete preview
is paged, has a five-minute lifetime, and is invalidated by relevant privacy changes.
Successful saves record an export audit event without logging the body or path.
If audit confirmation is unavailable after the file was saved, the UI reports that
separately from file-save success.

Reports reject unsupported options and excessive populations instead of silently
claiming completeness. Current bounds are 10,000 ledger/trial records and 20,000
evidence references, with an 8 MiB native output bound. Analytics retain their
documented group/day limits; tool/findings/compaction limits are explicit. Evidence
availability means a retained index reference, not a new verification of current
raw-file contents.

## Validation

Synthetic tests establish eligible paired comparisons, cheaper failed/setup-failed
variants remaining in the population, foreign evidence and duplicate-scope rejection,
incomparable-condition/truncation gates, immutable resource snapshots, exact token
and currency medians, report-version reconciliation, default-note exclusion and
Markdown/CSV escaping. The isolated Electron flow verifies trial visibility,
preview generation, exact file content after saving, export auditing and preserved
graph/trace navigation. Those fixtures do not establish outcomes for the user's
actual projects. Controlled local acceptance now freezes explicit inputs and artifact metadata, with
separate user review. AI-task execution, positive raw-artifact retention and physical
platform trials remain separate work.
