import { Command } from 'commander'

import { ConfigManager } from '@/config'
import { loadDb } from '@/db'
import { setupMeilisearch, updateIndexes } from '@/search'
import { WasmCodeService } from '@/services/wasm-codes'

const main = async () => {
  // Parse arguments.
  const program = new Command()
  program.option(
    '-c, --config <path>',
    'path to config file, falling back to config.json'
  )
  program.option(
    '-i, --index <index>',
    'only update the specified index, falling back to all indexes'
  )
  program.option(
    '-b, --batch-size <size>',
    'batch size for updating indexes',
    '100'
  )
  program.parse()
  const options = program.opts()

  // Load config from specific config file.
  ConfigManager.load(options.config)

  // Connect to db.
  const sequelize = await loadDb()

  // Set up wasm code service.
  await WasmCodeService.setUpInstance()

  try {
    // Setup meilisearch.
    await setupMeilisearch()

    // Update.
    const updated = await updateIndexes({
      index: options.index,
      batchSize: options.batchSize ? parseInt(options.batchSize) : undefined,
    })

    console.log(`Updated ${updated} documents.`)
  } catch (err) {
    throw err
  } finally {
    await sequelize.close()
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
