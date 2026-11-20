# Argus

A state-based indexer and API builder for the Cosmos SDK, originally built for
[DAO DAO](https://daodao.zone).

There are two main data ingestion tools:

- [tracer](./src/scripts/tracer.ts)
- [listener](./src/scripts/listener.ts)

### Tracer

The tracer ingests state events from a blockchain node processing blocks, like
an RPC or validator. Cosmos SDK binaries have a `--trace-store` flag that allows
dumping read/write/delete events from its KV store to a file. `mkfifo` is a
Linux command that creates a FIFO file, effectively a named pipe that looks like
a file on the filesystem—perfect for blocking cross-process communication. This
ensures the blockchain node won't progress until the state tracer reads each
line written to the FIFO file. If the tracer fails or lags, the node will wait,
ensuring no data is missed/lost.

In order to use the tracer, the preliminary setup steps are:

1. Set up a typical Cosmos SDK node and run it with the flag set, like:

   `gaiad start --trace-store ~/path/to/home/trace.pipe`.

2. Run `mkfifo ~/path/to/home/trace.pipe`. `~/path/to/home` corresponds to the
   `home` config field in `config.json`.

Data processors for the tracer can be found in
[src/tracer/handlers](./src/tracer/handlers/) and are typically associated with
a specific module, like `wasm` or `bank`. They are responsible for decoding and
matching a state event and then exporting it to the database.

There are many [DB models](./src/db/models/) corresponding to different handlers
and event types, with indexes optimized for queries.

### Listener

The listener is a lightweight block/transaction/message/event processor, like
most other indexers that exist (e.g. SubQuery, The Graph, etc.). This only
relies on an RPC, the `remoteRpc` field in `config.json`.

Data extractors for the listener can be found in
[src/listener/extractors](./src/listener/extractors/). They depend on data
sources, found in [src/listener/sources](./src/listener/sources), which are
responsible for finding specific data in a transaction (probably a message or
event), and then extractors are responsible for exporting the found data to the
database.

Extractors typically save data to [`Extraction`](./src/db/models/Extraction.ts)
models and can associate data with any address/name for queries.

#### Resuming and RPC errors

The listener records the last block it fully processed (every transaction
matched against the extractors and queued) in
`State.listenerLatestBlockHeight`, and on start it resumes from the next block.
It does not resume from `State.latestBlockHeight`, because the tracer and the
extract queue also advance that height, so after a crash it can be past blocks
the listener never processed. Until the listener has recorded a height (the
first start after the `20261120160000-add-listener-latest-block-height-to-state`
migration), it starts from `State.latestBlockHeight` as before. Run the data
migration before starting a listener, tracer or server built from this version,
because the `State` model now reads the new column.

Resuming is at least once: if the listener crashes part way through a block,
the whole block is processed again on restart, and transactions queued before
the crash are queued again. Extractions are upserted on
`(address, name, blockHeight)`, so the stored data does not change, but
extraction side effects such as webhooks can run twice for that block.

Transient RPC errors while fetching a block (`could not find results for
height`, HTTP 5xx, timeouts and connection resets) are retried with exponential
backoff, from 1 second up to 30 seconds between attempts. After a block has been
retrying for 1 minute, the listener logs a warning and sends a Sentry warning,
repeated every 5 minutes. After 30 minutes it gives up and halts, so the process
restarts and resumes from the same block. Other errors are retried 30 times, 1
second apart, as before. Connecting to the RPC at startup, or reconnecting
after a failed connection check, also retries transient errors with backoff for
up to 10 minutes.

## Setup

1. Create `config.json` from example `config.json.example`.

2. Install dependencies.

   ```bash
   npm install
   ```

3. Build the indexer.

   ```bash
   npm run build
   ```

4. Setup the database.

   ```bash
   # try migrating to generate the migrations table
   # this should FAIL, but that is ok
   npm run db:migrate:data

   npm run db:setup
   ```

5. Run the tracer, listener, or server.

   ```bash
   npm run trace:prod
   # OR
   npm run listen:prod
   # OR
   npm run serve:prod
   ```

6. Tell pm2 to run on startup.

   ```bash
   pm2 startup
   ```

### Config

Config defaults to loading from `config.json` in the root of the project, though
it supports loading from environment variables:

`env:KEY_NAME` in a field inside `config.json` will be replaced with the value of
the `KEY_NAME` environment variable, erroring if the variable is not set.

`envOptional:KEY_NAME` will not error if the variable is not set.

Environment variables/secrets are managed via
[Infisical](https://infisical.com) and used when deploying production servers.

Never pass an Infisical token or client secret as a command line argument
(for example `--token` or `--client-secret`): command lines are visible to
every local user in `ps` and `/proc/<pid>/cmdline`, and end up in shell
history. The Infisical CLI reads the token from the `INFISICAL_TOKEN`
environment variable, which `npm run with-infisical` exports from `.env`, and
the scripts below read and write secrets only through `.env` (mode 600) and
HTTPS request bodies. They print access token IDs and expiry times, never
tokens.

```bash
# Log in via web browser (set INFISICAL_TOKEN in .env)
npx @infisical/cli login

# Log in via Infisical Universal Auth: put the machine identity's credentials
# in .env with an editor (not with echo, which would put them in shell history)
#   INFISICAL_CLIENT_ID=...
#   INFISICAL_CLIENT_SECRET=...
# then create an access token and save it to .env as INFISICAL_TOKEN
npm run infisical:login
# Save the project ID to .env
echo "INFISICAL_PROJECT_ID=$(cat .infisical.json | jq -r '.workspaceId')" >> .env
# Save the environment to .env
echo "INFISICAL_ENVIRONMENT=$(cat .infisical.json | jq -r '.defaultEnvironment')" >> .env

# Run a command with the environment variables set
npm run with-infisical -- <command>

# e.g. run the server
npm run with-infisical -- npm run serve

# if you need to run a command that uses inline env variables in the cmd, wrap
# it in `bash -c '...'` to avoid eager shell expansion since the variables
# aren't defined until the script is run
npm run with-infisical -- bash -c 'echo $INFISICAL_ENVIRONMENT'
```

The access token in `.env` is renewed daily by the `renew-infisical-token` PM2
app (`npm run infisical:renew`), which rewrites `.env` atomically. The renewal
and `npm run infisical:login` both hold a lock file next to `.env`
(`.env.lock`, which contains only a process ID) while they replace the token,
so a rotation that overlaps the daily renewal is never overwritten: the
renewal keeps the newer token and discards its own result. A lock left behind
by a process that died is removed automatically. Set
`INFISICAL_API_URL` (including the `/api` suffix) in `.env` or the environment
to use a self-hosted or regional Infisical instance; the default is
`https://app.infisical.com/api`.

To rotate the access token:

```bash
# Keep a copy of the current .env so the old token can be revoked later
cp -p .env .env.pre-rotation
# Create a new access token and store it in .env
npm run infisical:login
# Restart the processes that use the token, then revoke the old token. This
# refuses to revoke the token currently in .env and checks that Infisical
# rejects the old token afterwards.
npm run infisical:revoke -- .env.pre-rotation
rm .env.pre-rotation
```

When nothing else still needs the old token,
`npm run infisical:login -- --revoke-previous` does both steps at once.

## Usage

Test the indexer:

```bash
npm run docker:test
```

Build the indexer:

```bash
npm run build
```

Run the exporter:

```bash
npm run export
```

Run the API server:

```bash
npm run serve
```

Spawn a console to interact with the various database models and API formulas:

```bash
npm run console
```

### Testing transformations with a dump file

To test transformations with a dump file:

1. Place `dump.trace.pipe` in the root of the project.

2. Create `config.dump-test.json`, making sure to set `rpc`, `bech32Prefix`, and
   any `codeIds` you need to test:

   ```bash
   cp config.dump-test.json.example config.dump-test.json
   ```

3. Add your `*.test.ts` test files to `src/test/dump`.

4. Run:

```bash
npm run docker:test:dump
```

## Docker

To build the Docker image, run:

```bash
npm run docker:build
```

To tag and push to a container registry, run:

```bash
docker tag argus:latest your-registry/argus:latest
docker push your-registry/argus:latest
```

## Documentation

To understand how this indexer works and why it exists, read through the
[documentation](./docs/start.md).

## Database utilities

### Add read-only user in PostgreSQL

```sql
REVOKE ALL ON DATABASE db FROM readonly_user;
-- revoke access from all databases
SELECT format('REVOKE ALL ON DATABASE %I FROM readonly_user;', datname) FROM pg_database \gexec
-- grant connection access to all databases
SELECT format('GRANT CONNECT, SELECT ON DATABASE %I TO readonly_user;', datname) FROM pg_database WHERE datname = 'accounts' OR datname LIKE '%_%net' \gexec
-- grant access to use SELECT on all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
-- grant access to list tables
GRANT USAGE ON SCHEMA public TO readonly_user;
-- grant read access to future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_user;
```

### Find the code IDs for a given Event key

```sql
SELECT DISTINCT ON("codeId") "codeId", "value" FROM "WasmStateEvents" INNER JOIN "Contracts" ON "Contracts"."address" = "WasmStateEvents"."contractAddress" WHERE "key" = '' ORDER BY "codeId" ASC;
```

Find by contract name (key is `contract_info`)

```sql
SELECT DISTINCT ON("codeId") "codeId", "value" FROM "WasmStateEvents" INNER JOIN "Contracts" ON "Contracts"."address" = "WasmStateEvents"."contractAddress" WHERE "key" = '99,111,110,116,114,97,99,116,95,105,110,102,111' AND value LIKE '%CONTRACT_NAME%' ORDER BY "codeId" ASC;
```

### Find the contracts with the most state events

```sql
WITH address_counts AS (
  SELECT
    "contractAddress",
    COUNT(*) as row_count
  FROM "WasmStateEvents"
  GROUP BY "contractAddress"
),
total AS (
  SELECT SUM(row_count) AS total_rows
  FROM address_counts
)
SELECT * FROM address_counts
JOIN total ON true
ORDER BY row_count DESC
LIMIT 200;
```

## Find all code IDs for a given contract type

```sql
SELECT DISTINCT c."codeId"
FROM "Contracts" c
JOIN "WasmStateEvents" w ON c."address" = w."contractAddress"
WHERE w."key" = '99,111,110,116,114,97,99,116,95,105,110,102,111'
AND w."value" LIKE '%"contract":"crates.io:contract_one%'
```

### Delete all events for contracts of a certain type except the info key

```sql
WITH bad_addresses AS (
  SELECT DISTINCT "address"
  FROM "Contracts"
  WHERE "codeId" IN (
      SELECT DISTINCT c."codeId"
      FROM "Contracts" c
      JOIN "WasmStateEvents" w ON c."address" = w."contractAddress"
      WHERE w."key" = '99,111,110,116,114,97,99,116,95,105,110,102,111'
      AND (
        w."value" LIKE '%"contract":"crates.io:contract_one%'
        OR w."value" LIKE '%"contract":"crates.io:contract_two%'
        OR w."value" LIKE '%"contract":"crates.io:contract_three%'
      )
  )
)
DELETE FROM "WasmStateEvents"
WHERE "contractAddress" IN (SELECT "address" FROM bad_addresses)
AND "key" != '99,111,110,116,114,97,99,116,95,105,110,102,111';
```

```sql

WITH bad_addresses AS (
  SELECT DISTINCT "address"
  FROM "Contracts"
  WHERE "codeId" IN (
      SELECT DISTINCT c."codeId"
      FROM "Contracts" c
      JOIN "WasmStateEvents" w ON c."address" = w."contractAddress"
      WHERE w."key" = '99,111,110,116,114,97,99,116,95,105,110,102,111'
      AND (
        w."value" LIKE '%"contract":"crates.io:contract_one%'
        OR w."value" LIKE '%"contract":"crates.io:contract_two%'
        OR w."value" LIKE '%"contract":"crates.io:contract_three%'
      )
  )
)
DELETE FROM "WasmStateEventTransformations"
WHERE "contractAddress" IN (SELECT "address" FROM bad_addresses)
AND "name" != 'info';
```

### View all table sizes

```sql
SELECT table_name, pg_size_pretty(pg_relation_size(quote_ident(table_name))) AS data_size, pg_size_pretty(pg_indexes_size(quote_ident(table_name))) AS index_size, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS total_size, pg_total_relation_size(quote_ident(table_name)) AS total_bytes FROM information_schema.tables WHERE table_schema = 'public' ORDER BY total_bytes DESC;
```

### View all database sizes

```sql
SELECT datname AS database_name, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE datname LIKE '%net' ORDER BY pg_database_size(datname) DESC;
```

## Attribution

Credit to ekez for the initial idea and design of the state-based x/wasm
indexer, and noah for the subsequent architecting, implementation, and
optimization. Built for [DAO DAO](https://daodao.zone) and the CosmWasm
ecosystem as a whole.
