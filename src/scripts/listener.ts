import { decodeRawProtobufMsg } from '@dao-dao/types/protobuf/utils'
import * as Sentry from '@sentry/node'
import { Command } from 'commander'
import Koa from 'koa'
import { Sequelize } from 'sequelize'

import { ConfigManager, testRedisConnection } from '@/config'
import { Block, State, loadDb } from '@/db'
import { getExtractors } from '@/listener'
import { ExtractQueue } from '@/queues/queues'
import { setupMeilisearch } from '@/search'
import { BlockIterator, WasmCodeService } from '@/services'
import { DbType, ExtractableTxInput, ExtractorEnv } from '@/types'
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
    WasmCodeService.instance.stopUpdater()
    blockIterator.stopFetching()
  })
  process.on('SIGTERM', async () => {
    console.log(`\n[${new Date().toISOString()}] Shutting down...`)

    // Stop services.
    WasmCodeService.instance.stopUpdater()
    blockIterator.stopFetching()
  })

  // Metrics object to share between health endpoint and block processor
  const metrics = {
    blockProcessingStartTime: 0,
    blocksProcessed: 0,
    overallAverage: 0,
    rollingAverage: 0,
    currentBlockHeight: 0,
    lastUpdateTime: 0,
  }

  // Serve health probe with metrics.
  const app = new Koa()
  app.use(async (ctx) => {
    ctx.status = 200
    ctx.body = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics: {
        currentBlockHeight: metrics.currentBlockHeight,
        blocksProcessed: metrics.blocksProcessed,
        overallAverageBlocksPerSecond: Number(
          metrics.overallAverage.toFixed(2)
        ),
        rollingAverageBlocksPerSecond: Number(
          metrics.rollingAverage.toFixed(2)
        ),
        uptimeSeconds:
          metrics.blockProcessingStartTime > 0
            ? Number(
                (
                  (Date.now() - metrics.blockProcessingStartTime) /
                  1000
                ).toFixed(1)
              )
            : 0,
        lastUpdateTime: new Date(metrics.lastUpdateTime).toISOString(),
      },
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

  // Block iteration tracking
  metrics.blockProcessingStartTime = Date.now()
  // let lastLogTime = Date.now()
  // const LOG_INTERVAL_MS = 10_000 // Log every 10 seconds

  // Rolling window for more accurate short-term average
  const ROLLING_WINDOW_SIZE = 100
  const blockTimestamps: number[] = []

  // Start iterating. This will resolve once the iterator is done (due to SIGINT
  // or SIGTERM).
  try {
    await blockIterator.iterate({
      onBlock: async ({ chainId, height, time }) => {
        const currentTime = Date.now()
        metrics.blocksProcessed++
        metrics.currentBlockHeight = Number(height)
        metrics.lastUpdateTime = currentTime

        // Add to rolling window
        blockTimestamps.push(currentTime)
        if (blockTimestamps.length > ROLLING_WINDOW_SIZE) {
          blockTimestamps.shift()
        }

        // Calculate averages
        const overallElapsedSeconds =
          (currentTime - metrics.blockProcessingStartTime) / 1000
        metrics.overallAverage = metrics.blocksProcessed / overallElapsedSeconds

        if (blockTimestamps.length >= 2) {
          const rollingElapsedSeconds =
            (currentTime - blockTimestamps[0]) / 1000
          metrics.rollingAverage =
            (blockTimestamps.length - 1) / rollingElapsedSeconds
        }

        // Log metrics periodically
        // if (currentTime - lastLogTime >= LOG_INTERVAL_MS) {
        //   console.log(`[${new Date().toISOString()}] Block processing metrics:`)
        //   console.log(`  - Current block: ${height}`)
        //   console.log(`  - Blocks processed: ${metrics.blocksProcessed}`)
        //   console.log(
        //     `  - Overall average: ${metrics.overallAverage.toFixed(2)} blocks/sec`
        //   )
        //   console.log(
        //     `  - Rolling average (${
        //       blockTimestamps.length
        //     } blocks): ${metrics.rollingAverage.toFixed(2)} blocks/sec`
        //   )
        //   lastLogTime = currentTime
        // }

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
      onTx: async (
        { hash, code, messages: rawMessages, height, events },
        { time }
      ) => {
        // Ignore unsuccessful TXs.
        if (code !== 0) {
          return
        }

        // Attempt to decode each message, ignoring errors and returning the
        // original message if it fails.
        const messages = rawMessages.flatMap((message) => {
          try {
            return decodeRawProtobufMsg(message)
          } catch {
            return message
          }
        })

        // Create input for extractors.
        const input: ExtractableTxInput = {
          hash,
          messages,
          events,
        }

        // Create extractor environment for queue.
        const env: Pick<ExtractorEnv, 'txHash' | 'block'> = {
          txHash: hash,
          block: {
            height: BigInt(height).toString(),
            timeUnixMs: BigInt(Date.parse(time)).toString(),
            timestamp: new Date(time).toISOString(),
          },
        }

        // Set up extractors with environment.
        const extractors = getExtractors()

        // Match messages with extractors and add to queue.
        for (const Extractor of extractors) {
          const data = Extractor.match(input)

          if (data.length > 0) {
            await ExtractQueue.addBulk(
              data.map((data) => ({
                name: `${Extractor.type} (${data.source})`,
                data: {
                  extractor: Extractor.type,
                  data,
                  env,
                },
              }))
            )

            console.log(
              `[${new Date().toISOString()}] TX ${hash} at block ${height} sent to "${
                Extractor.type
              }" extractor.`
            )
          }
        }
      },
      onError: (error) => {
        console.error(
          `[${new Date().toISOString()}] Listener error for ${error.type} (${
            error.blockHeight
          }${error.txHash ? `/${error.txHash}` : ''}):`,
          error
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
  } finally {
    // Close database connection.
    await dataSequelize.close()

    // Close queue.
    ExtractQueue.close()

    console.log(`[${new Date().toISOString()}] Listener halted.`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
