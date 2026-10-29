# Collector synchronization and exclusions

Collectors retain stable source/observation identities and enqueue statistics-only
batches in an AES-GCM encrypted local spool. A complete encrypted file is synced
and renamed before its export cursor is committed. Source prompts, tool results,
code and paths are not part of the outgoing event contract.

The receiver acknowledges a batch after committing its observations, accounting
revision and sequence. Replaying the same batch is idempotent. A changed body
under an existing batch ID is rejected. A client that loses the acknowledgement
keeps the encrypted file and retries. An already acknowledged file left behind
after a crash is removed on the next synchronization.

The spool is bounded to 256 MiB and seven days. When an old range must be dropped,
the exact transport gap is committed before files are removed. Restarting between
those two steps retains the gap. The dashboard shows recorded transport gaps;
they are not silently represented as complete request coverage.

## Deleting a remote source

1. The user deletes monitor-owned source data in the Mac dashboard. Its receiver
   immediately excludes that canonical source from reimport, including old clients.
2. An authenticated collector asks for its own pending exclusion controls before
   transmitting queued batches. Controls contain opaque source and deletion IDs.
3. The collector persists a recovery plan, removes its indexed copy and encrypted
   pending files, and records an exclusion. Original Codex files remain untouched.
4. Other retained source observations are queued with their original canonical
   identities under new transport sequences. A declared privacy transport gap
   retires replaced batches; replay does not count existing observations again.
5. Only after applying the exclusion does the collector acknowledge it. The
   dashboard distinguishes pending exclusions from collector-confirmed exclusions.

A restarted client finishes its saved exclusion plan before scanning or queuing
more data, including while offline. If its acknowledgement is lost, its durable
receipt avoids applying the same queue reset again. Revoked devices cannot poll
controls, acknowledge exclusions or ingest data. Controls and receipts are scoped
to the authenticated workspace/device. Backups and user-exported copies can remain;
an exclusion does not assert physical erasure of every historical copy.

Older receivers without the new controls endpoints remain usable. They cannot
confirm client-side exclusions until upgraded. The dashboard keeps that distinction
visible instead of treating an online heartbeat as a deletion receipt.

## Pairing confirmation

Pairing exchanges a one-time code for a device credential. The client saves the
credential using OS protection, saves its public configuration, and reads the
protected credential again before confirming persistence. A normal client restart
can complete a pending confirmation. Re-enrollment preserves the existing spool
key; if that key cannot be opened, pairing stops before rotating the server token.
No key or token is logged or included in the Windows delivery archive.

## Evidence

Synthetic HTTP integration checks cover an encrypted queue aged by 24 hours, an
actual refused connection, receiver/client restart, a lost acknowledgement,
deletion recovery from a persisted plan, retained-source replay, forged receipts,
workspace mismatch, revocation and interrupted gap cleanup. This is fault-injection
evidence; it is not a claim that a physical host was disconnected for 24 real hours.

The Windows package is a user-operated handoff. Physical Windows SSH/DPAPI execution
and offline file export/import remain separate outstanding work; the encrypted
outbound spool by itself is not an offline import format.

## Central project policies

Global/project constraints now use authenticated complete pages, durable application receipts and independent local expiry; local choices remain stricter and content consent is never granted centrally. See project-policy-sync.md for the current contract, deployment and compatibility evidence. Source exclusion receipts remain distinct.
