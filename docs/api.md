# API

The API has two components: the indexer API and the accounts API.

## Indexer

The indexer API supports two routes: one to retrieve the status of the exporter,
and one to query the indexer's data.

See the [formulas docs](./formulas.md) for more information on how to create API
endpoints.

When a formula is called, the indexer will first check the cache, and then
compute the formula if it is not cached. See the [cache docs](./cache.md) for
more information on how the cache works. Upon computing a formula, it will save
the result to the cache.

### API Routes

#### `GET /status`

This returns the status of the indexer.

```ts
{
  "latestBlock": {
    "height": string
    "timeUnixMs": string
  },
  "lastStakingBlockHeightExported": string | null
  "lastWasmBlockHeightExported": string | null
  "lastBankBlockHeightExported": string | null
  "lastGovBlockHeightExported": string | null
  "lastDistributionBlockHeightExported": string | null
}
```

#### `GET /:key/:type/:address/:formula`

(Alternative: `GET /:type/:address/:formula` with `key` in the `X-API-Key`
header.)

Other parameters:

- `block`: the block height and time (in milliseconds since epoch) to query
  (e.g. `16203:1683075370647`)
- `blocks`: a range of blocks to query (e.g. `16203:1683075370647..17203:1683081370647`)
- `blockStep`: the step between blocks to query if using a range (e.g. `100`)
- `time`: the time to query (e.g. `1683075370647`)
- `times`: a range of times to query (e.g. `1683075370647..1683081370647`)
- `timeStep`: the step between times to query if using a range (e.g. `10000`)

Any other parameters are forwarded to the formula in an `args` object.

Only one of `block`, `blocks`, `time`, or `times` can be specified. If none are
specified, the most recent block is used.

A range query returns an array of results, one for each block or time in the
range. The step parameter is optional and defaults to 1. Its response looks like
this:

```ts
[
  {
    "at": string // Only defined if step > 1.
    "value": any
    "blockHeight": number
    "blockTimeUnixMs": string
  },
  ...
]
```

An individual query, using `block`, `time`, or none of the above, returns a
single result. **Its response is the value returned from the formula.**

### GET `/:key/a/:aggregator`

(Alternative: `GET /a/:aggregator` with `key` in the `X-API-Key` header.)

Aggregators allow for complex aggregations of data over time, often by
leveraging multiple formula calls and range queries.

Aggregators are more flexible than formulas and define all of their own
arguments.

**Example**:

To query the `sumFormulaOverRange` aggregator:

```
GET /api/indexer/aggregate/generic/simpleNumeric/sumFormulaOverRange?formulaType=contract&formulaName=someContract/balance&targetAddress=contract123&startBlockHeight=1000000&endBlockHeight=1001000
```

The response will be the aggregated value (e.g., a JSON number for the sum).

## Accounts

The accounts API lets you manage accounts that can access the indexer API, as
well as create webhooks for events.

It is authenticated with a Cosmos wallet address and provides a JWT token that
can be used to access the indexer API. It is expected to be provided as a
`Bearer` token in the `Authorization` header once logged in.

### API Routes

#### POST `/payment-webhook/:paymentSource`

Webhook for payment events. The `paymentSource` parameter is the payment source
to listen for. Currently, only `cw-receipt` is supported.

This expects a secret key to be passed via the `X-API-Key` header.

Request:

```ts
{
  "receiptId": string
  "amount": string
  "previousAmount": string
  "serializedDenom": string
}
```

Response:

```ts
{
  "success": true
}
```

#### GET `/config`

Get the configuration to be used in a frontend.

Response:

```ts
{
  "config": {
    "cwReceiptPaymentAddress": string
    "nativeDenomAccepted": string
    "creditScaleFactor": number
    "webhookCreditCost": number
  }
}
```

on error:

```ts
{
  "error": string
}
```

#### GET `/nonce/:publicKey`

Get the nonce for a public key. This is used in the login signature.

Response:

```ts
{
  "nonce": number
}
```

#### POST `/login`

Log in a user and return a JWT token.

Request:

```ts
{
  "auth": {
    "type": string
    "nonce": number
    "chainId": string
    "chainFeeDenom": string
    "chainBech32Prefix": string
    "publicKey": string
  }
  "signature": string
}
```

Response:

```ts
{
  "token": string
}
```

#### GET `/keys`

List all keys.

Response:

```ts
{
  "keys": {
    "id": number
    "name": string
    "description": string | null
    "credits": {
      "paymentSource": "cw-receipt" | "manual"
      "paymentId": string
      "paidFor": boolean
      "paidAt": string | null
      "amount": string
      "used": string
    }[]
  }[]
}
```

#### POST `/keys`

Create a new key.

Request:

```ts
{
  "name": string
  "description": string | null
}
```

Response:

```ts
{
  "apiKey": string
  "createdKey": {
    "id": number
    "name": string
    "description": string | null
    "credits": {
      "paymentSource": "cw-receipt" | "manual"
      "paymentId": string
      "paidFor": boolean
      "paidAt": string | null
      "amount": string
      "used": string
    }[]
  }
}
```

or error:

```ts
{
  "error": string
}
```

#### POST `/keys/:id/reset`

Reset key.

Response:

```ts
{
  "key": string
}
```

or error:

```ts
{
  "error": string
}
```

#### GET `/code-id-sets`

List code ID sets.

Response:

```ts
{
  "codeIdSets": {
    "id": number
    "name": string
    "codeIds": number[]
  }[]
}
```

#### POST `/code-id-sets`

Create a new code ID set.

Request:

```ts
{
  "name": string
  "codeIds": number[]
}
```

Response:

```ts
{
  "id": number
}
```

or error:

```ts
{
  "error": string
}
```

#### PATCH `/code-id-sets/:id`

Update a code ID set.

Request:

```ts
{
  "name": string | undefined
  "codeIds": number[] | undefined
}
```

Empty response on success.

On error:

```ts
{
  "error": string
}
```

#### DELETE `/code-id-sets/:id`

Delete a code ID set.

Empty response on success.

On error:

```ts
{
  "error": string
}
```

#### GET `/webhooks`

List webhooks.

Response:

```ts
{
  "webhooks": {
    "id": number
    "accountKeyId": number | null
    "description": string | null
    "url": string
    "secret": string
    "onlyFirstSet": boolean
    "contractAddresses": string[]
    "codeIdSetIds": number[]
    "stateKey": string | null
    "stateKeyType": "item" | "map" | null
  }[]
}
```

#### GET `/webhooks/:id/events`

Get events for a webhook.

Response:

```ts
{
  "events": {
      "uuid": string
      "status": "pending" | "success" | "retrying" | "failure"
      "data": {
        "type": "state"
        "codeId": number
        "contractAddress": string
        "blockHeight": string
        "blockTimeUnixMs": string
        "blockTimestamp": Date
        "key": string
        "value": string
        "valueJson": any
        "delete": boolean
      }
      "url": string
      "attempts": {
        "sentAt": string
        "url": string
        "requestBody": string
        "requestHeaders": string
        "responseBody": string | null
        "responseHeaders": string | null
        "statusCode": number
      }[]
    }[]
}
```

#### POST `/webhooks/:id/events/:uuid/fire`

Fires a webhook event again, for testing.

Response:

```ts
{
  "attempt": {
    "sentAt": string
    "url": string
    "requestBody": string
    "requestHeaders": string
    "responseBody": string | null
    "responseHeaders": string | null
    "statusCode": number
  }
}
```

or error:

```ts
{
  "error": string
}
```

#### POST `/webhooks`

Create a new webhook.

Request:

```ts
{
  "description": string | null
  "url": string
  "onlyFirstSet": boolean
  "contractAddresses": string[] | null
  "stateKey": string | null
  "stateKeyType": "item" | "map" | null
  "accountKeyId": number
  "codeIdSetIds": number[]
}
```

Empty response on success.

On error:

```ts
{
  "error": string
}
```

#### PATCH `/webhooks/:id`

Update a webhook.

Request:

```ts
{
  "description": string | null | undefined
  "url": string | undefined
  "onlyFirstSet": boolean | undefined
  "contractAddresses": string[] | undefined
  "stateKey": string | null | undefined
  "stateKeyType": "item" | "map" | null | undefined
  "accountKeyId": number | undefined
  "codeIdSetIds": number[] | undefined
  "resetSecret": boolean | undefined
}
```

Empty response on success.

On error:

```ts
{
  "error": string
}
```

#### DELETE `/webhooks/:id`

Delete a webhook.

Empty response on success.

On error:

```ts
{
  "error": string
}
```
