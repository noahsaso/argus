import { decodeRawProtobufMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import * as Sentry from '@sentry/node'
import { Command } from 'commander'
import Koa from 'koa'
import { Sequelize } from 'sequelize'

import { ConfigManager, testRedisConnection } from '@/config'
import { Block, State, loadDb } from '@/db'
import { makeExtractors } from '@/listener'
import { ExtractQueue } from '@/queues/queues'
import { setupMeilisearch } from '@/search'
import { BlockIterator, WasmCodeService } from '@/services'
import { DbType } from '@/types'
import { AutoCosmWasmClient } from '@/utils'

declare global {
  interface BigInt {
    toJSON(): string
  }
}
BigInt.prototype.toJSON = function () {
  return this.toString() as string
}

// Parse arguments.
const program = new Command()
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.option(
  '-p, --port <port>',
  'port to serve health probe on',
  (value) => parseInt(value),
  3420
)
program.parse()
const { config: _config, port } = program.opts()

// Load config from specific config file.
const config = ConfigManager.load(_config)

if (!config.remoteRpc) {
  throw new Error('Config missing remote RPC.')
}

// Add Sentry error reporting.
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
  })
}

const main = async () => {
  console.log(`[${new Date().toISOString()}] Testing Redis connection...`)

  // Test Redis connection to ensure we can connect, throwing error if not.
  await testRedisConnection(true)

  console.log(`[${new Date().toISOString()}] Connecting to database...`)

  const dataSequelize = await loadDb({
    type: DbType.Data,
    configOverride: {
      pool: {
        min: 2,
        max: 5,
      },
    },
  })

  // Set up wasm code service.
  await WasmCodeService.setUpInstance({
    withUpdater: true,
  })

  // Initialize state.
  const state = await State.createSingletonIfMissing(config.chainId)

  console.log(
    `[${new Date().toISOString()}] State initialized: chainId=${
      state.chainId
    } latestBlockHeight=${state.latestBlockHeight} latestBlockTimeUnixMs=${
      state.latestBlockTimeUnixMs
    }`
  )

  // Set up meilisearch.
  await setupMeilisearch()

  console.log(
    `[${new Date().toISOString()}] Connecting to ${config.remoteRpc}...`
  )

  // Create CosmWasm client that batches requests.
  const autoCosmWasmClient = new AutoCosmWasmClient(config.remoteRpc)
  await autoCosmWasmClient.update()

  console.log(`[${new Date().toISOString()}] Setting up extractors...`)

  // Set up extractors.
  const extractors = await makeExtractors({
    config,
    autoCosmWasmClient,
    sendWebhooks: false,
  })

  console.log(`[${new Date().toISOString()}] Starting listener...`)

  const blockIterator = new BlockIterator({
    rpcUrl: config.remoteRpc,
    autoCosmWasmClient,
    startHeight: Number(state.latestBlockHeight),
  })

  // Add shutdown signal handlers.
  process.on('SIGINT', async () => {
    console.log(`\n[${new Date().toISOString()}] Shutting down...`)

    // Stop services.
    WasmCodeService.getInstance().stopUpdater()
    blockIterator.stopIterating()
  })
  process.on('SIGTERM', async () => {
    console.log(`\n[${new Date().toISOString()}] Shutting down...`)

    // Stop services.
    WasmCodeService.getInstance().stopUpdater()
    blockIterator.stopIterating()
  })

  // Serve health probe.
  const app = new Koa()
  app.use(async (ctx) => {
    ctx.status = 200
    ctx.body = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  })
  app.listen(port, () => {
    console.log(
      `\n[${new Date().toISOString()}] Listener ready, health probe on port ${port}.`
    )

    // Tell pm2 we're ready right before we start reading.
    if (process.send) {
      process.send('ready')
    }
  })

  // Start iterating. This will resolve once the iterator is done (due to SIGINT
  // or SIGTERM).
  await blockIterator.iterate({
    onBlock: async ({ header: { chainId, height, time } }) => {
      const latestBlockHeight = Number(height)
      const latestBlockTimeUnixMs = Date.parse(time)

      // Update state singleton with chain ID and latest block, and create
      // block.
      await Promise.all([
        State.updateSingleton({
          chainId,
          latestBlockHeight: Sequelize.fn(
            'GREATEST',
            Sequelize.col('latestBlockHeight'),
            latestBlockHeight
          ),
          latestBlockTimeUnixMs: Sequelize.fn(
            'GREATEST',
            Sequelize.col('latestBlockTimeUnixMs'),
            latestBlockTimeUnixMs
          ),
        }),
        Block.createOne({
          height: latestBlockHeight,
          timeUnixMs: latestBlockTimeUnixMs,
        }),
      ])
    },
    onTx: async ({ hash, tx: rawTx, height, events }, { header: { time } }) => {
      let tx
      try {
        tx = Tx.decode(rawTx)
      } catch (err) {
        console.error('Error decoding TX', hash, err)
        return
      }

      if (!tx.body) {
        console.error('No body in TX', hash, tx)
        return
      }

      // Attempt to decode each message, ignoring errors and returning the
      // original message if it fails.
      const messages = tx.body.messages.flatMap((message) => {
        try {
          return decodeRawProtobufMsg(message)
        } catch {
          return message
        }
      })

      // Match messages with extractors and add to queue.
      for (const { name, extractor } of extractors) {
        const data = extractor.match({
          hash,
          tx,
          messages,
          events,
        })

        if (data) {
          const timeUnixMs = Date.parse(time)
          await ExtractQueue.add(`${hash}-${name}`, {
            extractor: name,
            data: {
              txHash: hash,
              block: {
                height: BigInt(height).toString(),
                timeUnixMs: BigInt(timeUnixMs).toString(),
                timestamp: new Date(timeUnixMs).toISOString(),
              },
              data,
            },
          })

          console.log(
            `[${new Date().toISOString()}] TX ${hash} at block ${height} sent to "${name}" extractor.`
          )
        }
      }
    },
    onError: (error) => {
      console.error(
        `[${new Date().toISOString()}] Listener error for ${error.type} (${
          error.blockHeight
        }${error.txHash ? `/${error.txHash}` : ''}):`,
        error,
        error.cause
      )
      Sentry.captureException(error.cause, {
        tags: {
          script: 'listener',
          type: error.type,
          blockHeight: error.blockHeight,
          txHash: error.txHash,
        },
      })
    },
  })

  // Close database connection.
  await dataSequelize.close()

  // Close queue.
  ExtractQueue.close()

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
