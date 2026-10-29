# Owned-client context manifests

The passive desktop collector never intercepts another application's requests.
This optional module records the final ordered content at a boundary the user owns.
It must be called after the client's truncation, summarization and other known transformations.
Provider-side additions and cache spans are outside that boundary.

In **Context & tools**, enable **Accept local metadata manifests** and copy the
consent identifiers into the owned client's local configuration. This grants local
metadata import only. Disabling import does not stop Codex or install a hook.
Each new approval has a new consent ID; older scopes cannot add new records.

The build includes `dist-electron/owned-client.cjs`, exporting `observeOwnedRequest`.
The client supplies its own transport and metadata persistence function. The monitor
does not initiate paid requests. A minimal integration looks like this:

```js
const { observeOwnedRequest } = require('./owned-client.cjs');
const { writeFile } = require('node:fs/promises');
const records = [];
const persist = async record => {
  records.push(record);
  await writeFile('context.bundle.json', JSON.stringify({
    schema: 'owned-context-bundle/1', records,
  }), { mode: 0o600 });
};
await observeOwnedRequest({
  consent, // the identifiers approved in this monitor workspace
  clientId: 'my-owned-client', requestId, threadId, turnId,
  items: finalOrderedItems, // id, origin, text, optional estimate/operations
  persist,
  send: sendFinalItemsThroughMyTransport,
});
```

The transport receives the detached final items in order and the same request ID.
It returns an actual `responseId` or null. Persistence completes before transport
execution, so interrupted attempts can retain their manifest. A failed or cancelled
attempt records its state without retaining the error text. This hook does not
execute shell commands or attach itself to an unrelated Desktop process.

Import `context.bundle.json` using the native file chooser. The bundle is limited
to 2 MiB and 200 manifest/result records. Records are imported in capture order,
with a manifest before its result. Reimport is idempotent; changing an existing
request/result ID is a visible conflict and rolls back that import. Item IDs,
orders, origins, byte sizes, tokenizer name/version and transformation sizes are
allowed. Payload text, file paths, fingerprints, credentials and unknown fields
are rejected. IDs use letters, numbers, `.`, `_`, `:`, or `-`.

The active ledger is matched by exact local machine, thread, optional turn and
response IDs. A completed request without matching observed usage remains unknown.
Multiple matches or quarantined ledger entries cannot establish a clean match.
The manifest never creates a new usage entry or adds estimated tokens to totals.
For a common known tokenizer, ordered item estimates can be summed. Missing or
mixed tokenizer estimates remain unknown. An input-minus-estimate difference is
a discrepancy, including when negative; it is not measured hidden context.

Manifests remain separate from passive workflow measurements. Removing an item
changes the visible estimate but cannot establish provider savings. Those require
a comparable execution with the same quality contract. Source deletion removes
related monitor-owned manifests and suppresses their reimport. Receipt-time usage
retention also removes the associated results. Original logs and client-exported
files are untouched.

The synthetic controlled-boundary fixture proves pre-send persistence, content
order, UTF-8 byte length, request/result identity, exact response matching,
unknown/failure states, non-additive usage, replay/conflict handling and deletion.
It does not prove instrumentation of the user's normal Codex Desktop workflow.


## Version 2 facets

Use `schema: 'owned-context/2'` and optional `contextEpoch` when the owned client
can explicitly describe each occurrence. Every item then supplies `facets`:

```js
facets: {
  origin: 'project_file', transport: 'tool_result', state: 'retained',
  media: 'text', contentId: 'opaque-content-id', originalBytes: '4096',
  included: true, serializationIncluded: false,
}
```

Allowed values are defined in src/shared/context-manifests.ts. IDs must be opaque,
never content, credentials or paths. State is a client declaration. A removed item
uses state removed, included false and empty text; it is persisted as metadata but
is absent from the transport callback. Nontext items keep byte/token estimates
unknown. Schema-1 calls reject facets rather than silently dropping them. Imports
still use the metadata-only owned-context-bundle/1 envelope and the current local
consent. No hook is installed into another application. See context-attribution.md
for uncertainty, reconstruction and repeat-exposure rules.
