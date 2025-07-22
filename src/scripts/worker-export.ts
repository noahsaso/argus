import { Command } from 'commander'

import { ConfigManager } from '@/config'
import { State, loadDb } from '@/db'
import { QueueOptions } from '@/queues'
import { ExportQueue } from '@/queues/queues'
import { WasmCodeService } from '@/services/wasm-codes'
import { DbType } from '@/types'

// Parse arguments.
const program = new Command()
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.parse()
const { config: _config } = program.opts()

// Load config with config option.
const config = ConfigManager.load(_config)

const main = async () => {
  // Load DB on start.
  const dataSequelize = await loadDb({
    type: DbType.Data,
  })
  const accountsSequelize = await loadDb({
    type: DbType.Accounts,
  })

  // Set up wasm code service.
  await WasmCodeService.setUpInstance()

  // Initialize state.
  await State.createSingletonIfMissing(config.chainId)

  console.log(`\n[${new Date().toISOString()}] Starting export worker...`)

  // Create bull workers.
  const options: QueueOptions = {
    config,
    sendWebhooks: false,
  }

  const exportQueue = new ExportQueue(options)
  await exportQueue.init()
  const exportWorker = exportQueue.getWorker()

  exportWorker.on('ready', () => {
    console.log('Export worker ready')
  })
  exportWorker.on('active', (job) => {
    console.log(`Job ${job.id} active`)
  })
  exportWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`)
  })

  // Wait for export worker to finish all jobs.
  await new Promise((resolve) => {
    exportWorker.on('drained', () => {
      console.log('Export worker drained')
      resolve(true)
    })
  })

  // Stop services.
  WasmCodeService.getInstance().stopUpdater()

  // Close DB connections.
  await dataSequelize.close()
  await accountsSequelize.close()

  // Exit.
  process.exit(0)
}

main().catch((err) => {
  console.error('Export worker errored', err)
  process.exit(1)
})
