import { Command } from 'commander'

import { ConfigManager } from '@/config'
import { loadDb } from '@/db'
import { TransformationsQueue } from '@/queues/queues/transformations'
import { WasmCodeService } from '@/services/wasm-codes'

const main = async () => {
  // Parse arguments.
  const program = new Command()
  program.option(
    '-c, --config <path>',
    'path to config file, falling back to config.json'
  )
  program.option(
    '-i, --initial <block height>',
    'initial block height',
    (value) => parseInt(value, 10),
    0
  )
  program.option(
    '-b, --batch <size>',
    'batch size',
    (value) => parseInt(value, 10),
    50000
  )
  program.option(
    '-a, --addresses <addresses>',
    'comma separated list of contract addresses to transform',
    (value) => value.split(',')
  )
  program.option(
    '-k, --code-ids-keys <keys>',
    'comma separated list of code IDs keys from the config to transform, or ALL to transform all specified code IDs'
  )
  program.option(
    '-f, --force-all',
    'force transform all events (pass ALL to -k to transform just the specified code IDs)'
  )
  program.parse()
  const {
    config: _config,
    initial,
    batch,
    addresses,
    codeIdsKeys,
    forceAll,
  } = program.opts()

  // Load config from specific config file.
  ConfigManager.load(_config)

  // Load DB on start.
  const sequelize = await loadDb()

  // Set up wasm code service.
  const wasmCodeService = await WasmCodeService.setUpInstance()

  const job = await TransformationsQueue.add(
    `script_${Date.now()}`,
    {
      minBlockHeight: initial,
      batchSize: batch,
      addresses,
      codeIdsKeys:
        codeIdsKeys === 'ALL'
          ? wasmCodeService.getWasmCodes().map((wasmCode) => wasmCode.codeKey)
          : WasmCodeService.extractWasmCodeKeys(codeIdsKeys),
      forceAll,
    },
    {
      attempts: 1,
    }
  )

  const events = TransformationsQueue.getQueueEvents()
  events.on('progress', ({ data }) => {
    if (typeof data === 'number') {
      console.log(`transformed ${data}%`)
    }
  })

  try {
    await job.waitUntilFinished(events)
    console.log('finished!')
  } catch (error) {
    console.error('errored', error)
  }

  await sequelize.close()

  process.exit(0)
}

main()
