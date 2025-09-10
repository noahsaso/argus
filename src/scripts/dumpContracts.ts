/**
 * Dump all contract addresses from DB for matching code IDs keys.
 */

import { Command } from 'commander'
import { Op } from 'sequelize'

import { ConfigManager } from '@/config'
import { Contract, loadDb } from '@/db'
import { WasmCodeService } from '@/services'
import { DbType } from '@/types'

// Parse arguments.
const program = new Command()
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.requiredOption(
  '-k, --code-ids-keys <keys>',
  'comma separated list of code IDs keys from the config to revalidate (pass ALL to use all code IDs set)'
)
program.parse()
const { config: _config, codeIdsKeys } = program.opts()

const main = async () => {
  console.log(`\n[${new Date().toISOString()}] Dumping contracts...`)

  // Load config from specific config file.
  ConfigManager.load(_config)

  // Load DB on start.
  const sequelize = await loadDb({
    type: DbType.Data,
  })

  // Set up wasm code service.
  await WasmCodeService.setUpInstance()

  const extractedCodeIdsKeys =
    codeIdsKeys === 'ALL'
      ? 'ALL'
      : WasmCodeService.extractWasmCodeKeys(codeIdsKeys)
  const codeIds =
    extractedCodeIdsKeys === 'ALL'
      ? WasmCodeService.instance.getWasmCodes().flatMap((c) => c.codeIds)
      : WasmCodeService.instance.findWasmCodeIdsByKeys(...extractedCodeIdsKeys)

  if (codeIds.length === 0) {
    throw new Error(
      'No code IDs found matching keys: ' +
        (Array.isArray(extractedCodeIdsKeys)
          ? extractedCodeIdsKeys.join(', ')
          : extractedCodeIdsKeys)
    )
  }

  const contracts = await Contract.findAll({
    where: {
      codeId: {
        [Op.in]: codeIds,
      },
    },
  })

  console.log(contracts.map((c) => c.address).join(','))

  await sequelize.close()

  process.exit(0)
}

main()
