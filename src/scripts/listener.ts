import { decodeRawProtobufMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import * as Sentry from '@sentry/node'
import { Command } from 'commander'
import { Sequelize } from 'sequelize'

import { ConfigManager } from '@/config'
import { Block, State, loadDb } from '@/db'
import { extractorMakers } from '@/listener'
import { ExtractQueue } from '@/queues/queues'
import { setupMeilisearch } from '@/search'
import { BlockIterator, WasmCodeService } from '@/services'
import { DbType, NamedExtractor } from '@/types'
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
program.parse()
const { config: _config } = program.opts()

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

  // Set up meilisearch.
  await setupMeilisearch()

  // Create CosmWasm client that batches requests.
  const autoCosmWasmClient = new AutoCosmWasmClient(config.remoteRpc)
  await autoCosmWasmClient.update()

  // Set up extractors.
  const extractors = await Promise.all(
    Object.entries(extractorMakers).map(
      async ([name, extractorMaker]): Promise<NamedExtractor> => ({
        name,
        extractor: await extractorMaker({
          config,
          autoCosmWasmClient,
          sendWebhooks: false,
        }),
      })
    )
  )

  console.log(`\n[${new Date().toISOString()}] Starting listener...`)

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

  // Tell pm2 we're ready right before we start reading.
  if (process.send) {
    process.send('ready')
  }

  console.log(`[${new Date().toISOString()}] Listener ready.`)

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
    onTx: async ({ hash, tx: rawTx, height, events }) => {
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

      // Attempt to decode each message, ignoring errors.
      const messages = tx.body.messages.flatMap((message) => {
        try {
          return decodeRawProtobufMsg(message)
        } catch (err) {
          console.error('Error decoding message', err)
          return []
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
          await ExtractQueue.add(`${hash}-${name}`, {
            extractor: name,
            data: {
              txHash: hash,
              height: BigInt(height).toString(),
              data,
            },
          })

          console.log(
            `[${new Date().toISOString()}] TX ${hash} at block ${height} sent to "${name}" extractor.`
          )
        }
      }
    },
    onError: (type, error) => {
      console.error(
        `[${new Date().toISOString()}] Listener error: ${type}`,
        error
      )
      Sentry.captureException(error, {
        tags: {
          script: 'listener',
          type,
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
