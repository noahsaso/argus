import * as fs from 'fs'
import path from 'path'

import * as Sentry from '@sentry/node'
import { Command } from 'commander'

import { ConfigManager, testRedisConnection } from '@/config'
import { Block, State, loadDb } from '@/db'
import { ExportQueue } from '@/queues/queues/export'
import { setupMeilisearch } from '@/search'
import {
  BlockTimeFetcher,
  ChainWebSocketListener,
  WasmCodeService,
} from '@/services'
import {
  BatchedTraceExporter,
  TracerManager,
  handlerMakers,
  setUpFifoJsonTracer,
} from '@/tracer'
import { DbType, NamedHandler, TracedEvent } from '@/types'
import { AutoCosmWasmClient, objectMatchesStructure } from '@/utils'

// Parse arguments.
const program = new Command()
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.option(
  // Adds inverted `ws` boolean to the options object.
  '--no-ws',
  "don't connect to websocket"
)
program.option(
  '-o, --output <path>',
  'optionally write streamed state to another file, acting as a passthrough'
)
program.option('--allow-no-fifo', 'allow trace file to not be a FIFO file')
program.parse()
const {
  config: _config,
  output,
  ws: webSocketEnabled,
  allowNoFifo,
} = program.opts()

// Load config from specific config file.
const config = ConfigManager.load(_config)

if (!config.home) {
  throw new Error('Config missing home directory.')
}

// Add Sentry error reporting.
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
  })
}

const traceFile = path.join(config.home, 'trace.pipe')

const main = async () => {
  // Ensure trace file exists.
  if (!fs.existsSync(traceFile)) {
    throw new Error(
      `Trace file not found: ${traceFile}. Create it with "mkfifo ${traceFile}".`
    )
  }

  // Verify trace file is FIFOs.
  if (!allowNoFifo) {
    const stat = fs.statSync(traceFile)
    if (!stat.isFIFO()) {
      throw new Error(`Trace file is not a FIFO: ${traceFile}.`)
    }
  }

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

  // Create write stream for output if configured.
  const outputStream = output
    ? fs.createWriteStream(output, {
        flags: 'a',
      })
    : null

  console.log(
    `[${new Date().toISOString()}] Connecting to ${config.remoteRpc}...`
  )

  // Create CosmWasm client that batches requests.
  const autoCosmWasmClient = new AutoCosmWasmClient(config.remoteRpc)
  await autoCosmWasmClient.update()

  console.log(`[${new Date().toISOString()}] Setting up handlers...`)

  // Set up handlers.
  const handlers = await Promise.all(
    Object.entries(handlerMakers).map(
      async ([name, handlerMaker]): Promise<NamedHandler> => ({
        name,
        handler: await handlerMaker({
          config,
          autoCosmWasmClient,
          sendWebhooks: false,
        }),
      })
    )
  )

  console.log(`[${new Date().toISOString()}] Starting tracer...`)

  const webSocketListener = new ChainWebSocketListener('NewBlock')
  const blockTimeFetcher = new BlockTimeFetcher(
    autoCosmWasmClient,
    webSocketListener
  )

  webSocketListener.onNewBlock(async ({ chain_id, height, time }) => {
    const latestBlockHeight = Number(height)
    const latestBlockTimeUnixMs = Date.parse(time)

    // Cache block time for block height in cache used by state.
    blockTimeFetcher.cache.set(latestBlockHeight, latestBlockTimeUnixMs)

    // Update state singleton with chain ID, and create block.
    await Promise.all([
      State.updateSingleton({
        chainId: chain_id,
      }),
      Block.createOne({
        height: latestBlockHeight,
        timeUnixMs: latestBlockTimeUnixMs,
      }),
    ])
  })

  const exporter = new BatchedTraceExporter()
  const manager = new TracerManager(handlers, blockTimeFetcher, exporter)

  const { promise: tracer, close: closeTracer } = setUpFifoJsonTracer({
    file: traceFile,
    onData: (data) => {
      const tracedEvent = data as TracedEvent

      // Output if configured.
      outputStream?.write(JSON.stringify(tracedEvent) + '\n')

      // Ensure this is a traced write or delete event.
      if (
        !objectMatchesStructure(tracedEvent, {
          operation: {},
          key: {},
          value: {},
          metadata: {
            blockHeight: {},
          },
        })
      ) {
        return
      }

      // Only handle writes and deletes.
      if (
        tracedEvent.operation !== 'write' &&
        tracedEvent.operation !== 'delete'
      ) {
        return
      }

      // If trace has `store_name` that does not exist in any of the handlers,
      // ignore.
      if (
        tracedEvent.metadata.store_name &&
        !handlers.some(
          ({ handler }) => handler.storeName === tracedEvent.metadata.store_name
        )
      ) {
        return
      }

      manager.enqueue(tracedEvent)
    },
  })

  // If WebSocket enabled, connect to it before queueing.
  if (webSocketEnabled) {
    console.log(`[${new Date().toISOString()}] Connecting to WebSocket...`)
    webSocketListener.connect()
  }

  // Add shutdown signal handlers.
  process.on('SIGINT', () => {
    // Tell tracer to close. The rest of the data in the buffer will finish
    // processing.
    closeTracer()
    console.log(
      `\n[${new Date().toISOString()}] Shutting down after handlers finish...`
    )
  })
  process.on('SIGTERM', () => {
    // Tell tracer to close. The rest of the data in the buffer will finish
    // processing.
    closeTracer()
    console.log(
      `\n[${new Date().toISOString()}] Shutting down after handlers finish...`
    )
  })

  // Add user signal handler to log variables.
  process.on('SIGUSR1', () => {
    console.log(
      [
        'SIGUSR1:',
        `Memory: ${JSON.stringify(process.memoryUsage(), null, 2)}`,
        `Inbound queue size: ${manager.inboundQueueSize.toLocaleString()}`,
        `Outbound queue size: ${manager.outboundQueueSize.toLocaleString()}`,
        `Pending export batch size: ${exporter.pendingBatchSize.toLocaleString()}`,
      ].join('\n')
    )
  })

  // Tell pm2 we're ready right before we start reading.
  if (process.send) {
    process.send('ready')
  }

  console.log(`\n[${new Date().toISOString()}] Tracer ready.`)

  // Wait for tracer to close. Happens on FIFO closure or if `closeTracer` is
  // manually called, such as in the SIGINT handler above.
  await tracer

  // Wait for trace queue and exporter to finish exporting.
  console.log(
    `[${new Date().toISOString()}] Shutting down after processing ${manager.totalQueueSize.toLocaleString()} traces and ${exporter.pendingBatchSize.toLocaleString()} pending exports...`
  )

  // Wait for everything to export, now that the tracer is closed and no more
  // data is being queued.
  await manager.awaitFlush()

  // Stop services.
  WasmCodeService.getInstance().stopUpdater()
  webSocketListener.disconnect()

  // Close database connection.
  await dataSequelize.close()

  // Close queue.
  await ExportQueue.close()

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
