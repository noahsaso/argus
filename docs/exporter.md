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

## Excluding contracts

Set `excludedContractAddresses` in `config.json` to a list of contract addresses
to stop indexing them entirely:

```json
{
  "excludedContractAddresses": ["juno1..."]
}
```

Matching is by exact address only, so other contracts instantiated from the
same code ID are still indexed. When the option is absent or an empty list,
behavior is unchanged. A value that is not an array of non-empty strings fails
startup instead of being ignored.

For an excluded contract:

- The wasm tracer handler drops its state and contract-info trace events in
  `match`, before processing. They create no `WasmStateEvents` or `Contracts`
  rows, trigger no code ID lookups, transformations or webhooks, and enqueue no
  contract state recovery or wasm code tracker jobs. Export jobs queued before
  the contract was excluded are filtered the same way when they are processed.
- Listener extractors skip `wasm/event` and `wasm/instantiate-or-migrate` data
  whose contract address is excluded, so no extractions are created for it.
- Contract state recovery jobs for it are skipped, and the
  `POST /contract/:address/state/recover` route returns 403.

The option is read when each process starts, so restart the tracer, listener,
workers and server after changing it. Excluding a contract does not delete data
already indexed for it; remove that separately if needed.
