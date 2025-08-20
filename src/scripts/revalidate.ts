// This command will revalidate all computations in the database. This means it
// will ensure they are still valid, and replace them if not.

import { Command } from 'commander'
import { Op } from 'sequelize'

import { ConfigManager } from '@/config'
import { Computation, Contract, loadDb } from '@/db'
import { WasmCodeService } from '@/services/wasm-codes'

const LOADER_MAP = ['—', '\\', '|', '/']

const main = async () => {
  // Parse arguments.
  const program = new Command()
  program.option(
    '-c, --config <path>',
    'path to config file, falling back to config.json'
  )
  program.option(
    '-b, --batch <size>',
    'batch size',
    (value) => parseInt(value, 10),
    1000
  )
  program.option(
    '-k, --code-ids-keys <keys>',
    'comma separated list of code IDs keys from the config to revalidate'
  )
  program.option(
    '-f, --formulas <formulas>',
    'comma separated list of formula names to revalidate'
  )
  program.option(
    '-i, --initial <id>',
    'initial computation ID to start from',
    (value) => parseInt(value, 10),
    0
  )
  program.parse()
  const {
    config: _config,
    batch,
    codeIdsKeys,
    formulas,
    initial,
  } = program.opts()

  console.log(`\n[${new Date().toISOString()}] Revalidating computations...`)
  const start = Date.now()

  // Load config from specific config file.
  ConfigManager.load(_config)

  // Load DB on start.
  const sequelize = await loadDb()

  // Set up wasm code service.
  await WasmCodeService.setUpInstance()

  let latestId = initial - 1
  let updated = 0
  let replaced = 0
  const formulasReplaced = new Set<string>()

  const extractedCodeIdsKeys = WasmCodeService.extractWasmCodeKeys(codeIdsKeys)
  const codeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
    ...extractedCodeIdsKeys
  )

  if (extractedCodeIdsKeys.length > 0 && codeIds.length === 0) {
    throw new Error(
      'No code IDs found matching keys: ' + extractedCodeIdsKeys.join(', ')
    )
  }

  const contracts =
    codeIds.length > 0
      ? await Contract.findAll({
          where: {
            codeId: {
              [Op.in]: codeIds,
            },
          },
        })
      : undefined
  const contractWhere = contracts?.length
    ? {
        targetAddress: contracts.map((contract) => contract.address),
      }
    : undefined

  const formulaWhere =
    typeof formulas === 'string'
      ? {
          formula: formulas.split(','),
        }
      : {}

  const total = await Computation.count({
    where: {
      id: {
        [Op.gt]: latestId,
      },
      ...contractWhere,
      ...formulaWhere,
    },
  })

  // Print latest statistics every 100ms.
  let printLoaderCount = 0
  const printStatistics = () => {
    printLoaderCount = (printLoaderCount + 1) % LOADER_MAP.length
    process.stdout.write(
      `\r${
        LOADER_MAP[printLoaderCount]
      }  Updated/replaced: ${updated.toLocaleString()}/${replaced.toLocaleString()}. Processed: ${(
        updated + replaced
      ).toLocaleString()}/${total.toLocaleString()}. Elapsed: ${(
        (Date.now() - start) /
        1000
      ).toFixed(0)} seconds. Latest ID: ${latestId.toLocaleString()}`
    )
  }
  const logInterval = setInterval(printStatistics, 100)
  // Allow process to exit even though this interval is alive.
  logInterval.unref()

  while (updated + replaced < total) {
    const computations = await Computation.findAll({
      where: {
        id: {
          [Op.gt]: latestId,
        },
        ...contractWhere,
        ...formulaWhere,
      },
      limit: batch,
      order: [['id', 'ASC']],
    })

    // If there are no more computations, we're done.
    if (computations.length === 0) {
      break
    }

    latestId = computations[computations.length - 1].id

    const revalidations = await Promise.all(
      computations.map((computation) => computation.revalidate())
    )

    updated += revalidations.reduce((acc, valid) => acc + (valid ? 1 : 0), 0)
    replaced += revalidations.reduce((acc, valid) => acc + (valid ? 0 : 1), 0)

    // Log formulas that were replaced if not yet replaced.
    revalidations.forEach((valid, i) => {
      if (valid) {
        return
      }

      const formula = computations[i].formula
      if (!formulasReplaced.has(formula)) {
        formulasReplaced.add(formula)
        console.log(
          `\n[${new Date().toISOString()}] Replaced formula: ${formula}`
        )
      }
    })
  }

  clearInterval(logInterval)

  printStatistics()
  console.log(
    `\n[${new Date().toISOString()}] Revalidation complete${
      formulas
        ? ` matching filters:\n${[
            codeIdsKeys ? `code IDs keys: ${codeIdsKeys.split(',')}` : '',
            formulas ? `formulas: ${formulas.split(',')}` : '',
          ]
            .filter(Boolean)
            .join('\n')}`
        : ''
    }`
  )

  await sequelize.close()

  process.exit(0)
}

main()
