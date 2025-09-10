import * as Sentry from '@sentry/node'
import { Command } from 'commander'

import { ConfigManager, testRedisConnection } from '@/config'
import { State, loadDb } from '@/db'
import { QueueOptions, queues } from '@/queues'
import { WasmCodeService } from '@/services/wasm-codes'
import { DbType } from '@/types'

// Parse arguments.
const program = new Command()
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.option(
  // Adds inverted `webhooks` boolean to the options object.
  '--no-webhooks',
  "don't send webhooks"
)
program.option(
  '-m, --mode <mode>',
  'mode to run in (default, background)',
  'default'
)
program.parse()
const { config: _config, webhooks, mode } = program.opts()

// Load config from specific config file.
const config = ConfigManager.load(_config)

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

  // Load DB on start.
  const dataSequelize = await loadDb({
    type: DbType.Data,
  })
  const accountsSequelize = await loadDb({
    type: DbType.Accounts,
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

  console.log(`[${new Date().toISOString()}] Starting workers...`)

  // Create bull workers.
  const options: QueueOptions = {
    config,
    sendWebhooks: !!webhooks,
  }

  const workers = (
    await Promise.all(
      queues.map(async (Queue) => {
        const queue = new Queue(options)
        if (queue.mode !== mode) {
          return []
        }

        await queue.init()
        return queue.getWorker()
      })
    )
  ).flat()

  // Add shutdown signal handler.
  process.on('SIGINT', () => {
    if (workers.every((w) => w.closing)) {
      console.log('Already shutting down.')
    } else {
      console.log('Shutting down after current worker jobs complete...')
      // Exit once all workers close.
      Promise.all(workers.map((worker) => worker.close())).then(async () => {
        // Stop services.
        WasmCodeService.instance.stopUpdater()

        // Close DB connections.
        await dataSequelize.close()
        await accountsSequelize.close()

        // Exit.
        process.exit(0)
      })
    }
  })

  // Tell pm2 we're ready.
  if (process.send) {
    process.send('ready')
  }

  console.log(`\n[${new Date().toISOString()}] Workers ready.`)
}

main().catch((err) => {
  console.error('Processor errored', err)
  process.exit(1)
})
