# Exporter

The exporter is the piece of the indexer that exports data from the blockchain
binary/node to the database. As the exporter is exporting, it also transforms
data, updates the cache, and triggers webhooks based on state changes. More
information on each of these can be found in their respective docs:

- [transformers docs](./transformers.md)
- [cache docs](./cache.md)
- [webhooks docs](./webhooks.md)

## Responsibilities

### Transforming data

The exporter transforms state change events using the configured transformers.
See the [transformers docs](./transformers.md) for more information about
transformations and why they are necessary.

### Firing webhooks

The exporter fires webhooks when it detects a state change event that matches a
configured webhook. See the [webhooks docs](./webhooks.md) for more information
about webhooks and how they work.

### Invalidating the cache

The exporter invalidates the cache when it detects a state change event that
invalidates a computation. See the [cache docs](./cache.md) for more information
about the cache.

## Chain node restarts and upgrades

The chain node writes KV traces to a FIFO. When the node stops for a restart or
binary upgrade, it closes that FIFO writer. The exporter keeps running and
reopens its FIFO reader so that it automatically consumes traces when the
replacement node writer connects.

After a restart, verify that the export height returned by `/status` advances.
The `/up` route considers the indexer caught up only when its exported block is
within the existing five-block threshold of the remote chain. A local RPC block
is included in the response for diagnostics, but local node health does not
prove that the exporter consumed its traces.

## Recovering after a trace outage

Do not run recovery against production without authorization. First deploy or
restart the exporter and verify that `/status` advances beyond the last block
before the outage. For example, the Juno v30 upgrade occurred at height
`40,420,069`, so an exporter frozen at `40,420,068` must advance beyond that
boundary before repairing state.

For a fast current-state repair of a known contract, use the authenticated
recovery route:

```bash
curl -u 'exporter:<password>' -X POST \
  'https://<indexer-host>/<chain-id>/contract/<address>/state/recover?rpc=local&pageLimit=1000'
```

Verify the affected formulas after recovery. Repeat this operation for every
known contract whose state changed during the gap if current query correctness
is required.

This recovery fetches and stores the contract's current keys. It does **not**
remove indexed keys that are now absent, and it cannot reconstruct intermediate
state changes or historical events from the outage. Full-fidelity recovery
requires an authorized node restored at or before the last exported height,
replay with KV tracing into an isolated Argus recovery database, validation,
and an approved promotion or merge procedure. Never point a historical replay
at production without a dedicated runbook and backup.
