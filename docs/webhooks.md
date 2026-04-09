# Webhooks

Webhooks allow you to notify your own application right when a state change
event occurs. This effectively lets you listen to events on the blockchain in
real time.

Webhooks are defined in the `data/webhooks` directory. Accounts can also create
webhooks using the API. See the [API docs](./api.md) for more information.

Be sure to check out the [keys docs](./keys.md) for a very important explanation
of how keys are formatted. It describes some utility functions that are
essentially required to create webhooks, specifically `dbKeyToKeys`.

## Webhook Types

A webhook contains filters that determine which events it should be called for,
an endpoint to call, and a function to get the value to send to the endpoint. It
looks very similar to a transformer. Check out the [transformers
docs](./transformers.md) for more information on how transformers work.

Webhooks support two types of endpoints: `Url` and `Soketi`. URL endpoints are
called with a HTTP request, while Soketi endpoints use the `soketi` config and a
JS library to interact with it. If you are not using WebSockets, you can ignore
Soketi and use URL endpoints only.

URL webhooks are delivered with at-least-once semantics. BullMQ retries failed
jobs up to 3 times with exponential backoff, and the queue worker applies an
explicit HTTP timeout to each outbound request. Consumers should treat webhook
payloads as retryable and use a deterministic idempotency key when available.

```ts
type Webhook<
  Event extends DependableEventModel = DependableEventModel,
  Value = any
> = {
  filter: {
    /**
     * Required to filter events by type. This should be set to the class itself
     * of the type of event to consider. This can be any class that extends
     * DependableEventModel, such as WasmStateEvent or GovStateEvent.
     */
    EventType: new (...args: any) => Event
  } & Partial<{
    /**
     * If passed, contract must match one of these code IDs keys.
     *
     * Only relevant when event is a WasmStateEvent.
     */
    codeIdsKeys: string[]
    /**
     * If passed, contract must match one of these contract addresses.
     *
     * Only relevant when event is a WasmStateEvent.
     */
    contractAddresses: string[]
    /**
     * A function to support any custom matching logic.
     */
    matches: (event: Event) => boolean
  }>
  // If returns undefined, the webhook will not be called.
  endpoint:
    | WebhookEndpoint
    | undefined
    | ((event: Event, env: ContractEnv) => WebhookEndpoint | undefined)
    | ((event: Event, env: ContractEnv) => Promise<WebhookEndpoint | undefined>)
  // If returns undefined, the webhook will not be called.
  getValue: (
    event: Event,
    getLastEvent: () => Promise<Event | null>,
    env: ContractEnv
  ) => Value | undefined | Promise<Value | undefined>
}

type WebhookEndpoint =
  | {
      type: WebhookType.Url
      url: string
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      headers?: Record<string, string>
    }
  | {
      type: WebhookType.Soketi
      channel: string | string[]
      event: string
    }

type WebhookMaker<
  Event extends DependableEventModel = DependableEventModel,
  Value = any
> = (config: Config, state: State) => Webhook<Event, Value> | null | undefined
```

## How to write a webhook

Writing a webhook is very similar to writing a transformer, so check out the
[transformers docs](./transformers.md) for more information on how transformers
work.

To add a new webhook, it must be exported from `src/data/webhooks/index.ts`.
Webhooks can also be wrapped in webhook makers, which are functions that take
the config and database state and return a webhook. This is useful for webhooks
that need to access API keys in the config or other state information.

## Example

The following webhook notifies the indexer's own accounts API when a payment
goes through on a payment smart contract. It uses both key utility functions to
transform keys from and to the database format.

````ts
const makeIndexerCwReceiptPaid: WebhookMaker<WasmStateEvent> = (config) =>
  !config.payment
    ? null
    : {
        filter: {
          EventType: WasmStateEvent,
          contractAddresses: [config.payment.cwReceiptAddress],
          // Filter for receipt_totals state changes.
          matches: (event) => event.key.startsWith(dbKeyForKeys('receipt_totals', '')),
        },
        endpoint: async () =>
          !config.payment
            ? undefined
            : {
                type: WebhookType.Url,
                url: 'https://accounts.indexer.zone/payment-webhook/cw-receipt',
                method: 'POST',
                headers: {
                  'X-API-Key': config.payment.cwReceiptWebhookSecret,
                },
              },
        getValue: async (event, getLastEvent) => {
          // "receipt_totals" | receiptId | serializedDenom
          const [, receiptId, serializedDenom] = dbKeyToKeys(event.key, [
            false,
            false,
            false,
          ])
          const amount = event.valueJson
          const previousAmount = (await getLastEvent())?.valueJson || '0'

          return {
            receiptId,
            amount,
            previousAmount,
            serializedDenom,
          }
        },
      }
      ```
````

## Deposit webhook

The Xion deposit webhook integration emits normalized deposit detections as
`Extraction` events and forwards them through the built-in webhook queue.
Registrations are created per account through the authenticated account API, not
through static indexer config.

This is a deposit-detection webhook, not a generic balance-change feed. It only
fires when the indexer observes a matching inbound native-bank or CW20 transfer
into a watched wallet for an allowed asset.

Create a registration with `POST /deposit-webhook-registrations`:

```ts
{
  "description": "Sandbox deposit listener",
  "endpointUrl": "https://partner.example/deposits",
  "authHeader": "Authorization",
  "authToken": "secret-token",
  "watchedWallets": ["xion1..."],
  "allowedNativeDenoms": ["uxion"],
  "allowedCw20Contracts": ["xion1stablecoin..."],
  "enabled": true
}
```

Example:

```sh
curl -X POST https://daodaoindexer.burnt.com/deposit-webhook-registrations \
  -H 'Authorization: Bearer <account-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "description": "Sandbox deposit listener",
    "endpointUrl": "https://partner.example/deposits",
    "authHeader": "Authorization",
    "authToken": "secret-token",
    "watchedWallets": ["xion1watchedwallet"],
    "allowedNativeDenoms": ["uxion"],
    "allowedCw20Contracts": ["xion1stablecoincontract"],
    "enabled": true
  }'
```

Each registration owns:

- the destination webhook URL
- optional auth header and token
- one or more watched wallet addresses
- one or more allowed native denoms and/or CW20 contract addresses

When a matching deposit is detected, the indexer sends `POST` to the
registration's `endpointUrl` with:

- `Content-Type: application/json`
- `Idempotency-Key: <deterministic-key>`
- the configured auth header, if one was supplied

Example native-asset payload:

```json
{
  "idempotencyKey": "xion-mainnet-1:7:ABC123...:xion1watchedwallet:native:uxion:42000000:2:0",
  "wallet": "xion1watchedwallet",
  "recipient": "xion1watchedwallet",
  "sender": "xion1senderwallet",
  "amount": "42000000",
  "assetType": "native",
  "denom": "uxion",
  "contractAddress": null,
  "blockHeight": "1234567",
  "blockTimeUnixMs": "1710000000000",
  "txHash": "ABC123..."
}
```

The `txHash` field is part of the stable deposit webhook payload contract and is
intended to be used by downstream consumers for on-chain verification and
idempotent ingest.

Example CW20 payload:

```json
{
  "idempotencyKey": "xion-mainnet-1:7:DEF456...:xion1watchedwallet:cw20:xion1stablecoincontract:1000000:4",
  "wallet": "xion1watchedwallet",
  "recipient": "xion1watchedwallet",
  "sender": "xion1senderwallet",
  "amount": "1000000",
  "assetType": "cw20",
  "denom": null,
  "contractAddress": "xion1stablecoincontract",
  "blockHeight": "1234568",
  "blockTimeUnixMs": "1710000005000",
  "txHash": "DEF456..."
}
```

For bank multi-send events, `sender` may be `null` when multiple input wallets
fund the same output and the provenance is ambiguous.

The deposit webhook extractor uses `chainId` as part of the deterministic
idempotency key. If `chainId` is omitted from config, it falls back to the
connected RPC client chain ID.

When `authHeader` is `Authorization`, the indexer automatically prefixes the
token with `Bearer ` unless the token already includes it. Deposit webhook
requests also include an `Idempotency-Key` header derived from the normalized
deposit event. Consumers should treat the body plus `Idempotency-Key` and
`txHash` as the canonical deposit-detection payload.

Delivery is at-least-once. Failed webhook jobs are retried by BullMQ with
exponential backoff, and duplicate delivery is possible. Consumers should treat
the webhook as a retryable signal and make downstream ingestion idempotent.

Operational guidance:

- Return a `2xx` response as soon as the request is durably accepted.
- Do on-chain verification asynchronously after acknowledgement.
- Use `Idempotency-Key` and/or `txHash` to make ingestion idempotent.
- Keep the endpoint fast. The queue worker applies an HTTP timeout to outbound
  webhook delivery.
