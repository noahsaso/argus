import { Command } from 'commander'

import { ConfigManager } from '@/config'
import { SyncExtractorsQueue } from '@/queues/queues'

const main = async () => {
  // Parse arguments.
  const program = new Command()
  program.option(
    '-c, --config <path>',
    'path to config file, falling back to config.json'
  )
  program.option(
    '-e, --extractors <extractors>',
    'comma-separated list of extractors to sync, or `ALL` to sync all extractors',
    (value) => value.split(','),
    []
  )
  program.option(
    '-f, --flags <flags>',
    'comma-separated list of flags to pass to the extractors',
    (value) => value.split(','),
    []
  )
  program.parse()
  const { config: _config, extractors, flags } = program.opts()

  // Load config from specific config file.
  ConfigManager.load(_config)

  if (!extractors.length) {
    throw new Error(
      'pass `-e` with a comma-separated list of extractors to sync, or `ALL` to sync all extractors'
    )
  }

  const job = await SyncExtractorsQueue.add(
    `script_${Date.now()}`,
    { extractors, flags },
    { attempts: 1 }
  )

  if (!job.id) {
    throw new Error(
      'job ID not found, cannot listen to logs. check dashboard for progress.'
    )
  }

  console.log('job running. logs will be printed below:')

  // Every 100ms, print the job logs.
  const queue = SyncExtractorsQueue.getQueue()
  let start = 0
  const logger = setInterval(async () => {
    const { logs } = await queue.getJobLogs(job.id!, start)
    if (logs.length > 0) {
      start += logs.length
      console.log(logs.join('\n'))
    }
  }, 100)

  try {
    await job.waitUntilFinished(SyncExtractorsQueue.getQueueEvents())
    console.log('\nfinished!')
  } catch (error) {
    console.error('\nerrored', error)
  } finally {
    clearInterval(logger)
  }

  process.exit(0)
}

main()
