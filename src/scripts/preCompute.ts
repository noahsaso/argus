import { Command } from 'commander'

import { ConfigManager } from '@/config'
import { Block, Computation, Contract, State, loadDb } from '@/db'
import { computeRange, getTypedFormula } from '@/formulas'
import { WasmCodeService } from '@/services/wasm-codes'
import { Block as BlockType } from '@/types'
import { bigIntMin, validateBlockString } from '@/utils'

export const main = async () => {
  // Parse arguments.
  const program = new Command()
  program.requiredOption(
    '-f, --formula <type/formula>',
    'formula name to compute'
  )
  program.option('-a, --args <args>', 'JSON args to pass to formula', '{}')
  program.option(
    '-t, --targets <addresses>',
    'comma-separated list of target addresses',
    (value) => value.split(',')
  )
  program.option(
    '-i, --ids <code IDs>',
    'comma-separated list of code IDs',
    (value) => value.split(',').map((id) => parseInt(id, 10))
  )
  program.option(
    '-k, --code-ids-keys <keys>',
    'comma separated list of code IDs keys from the config',
    (value) => value.split(',')
  )
  program.option(
    '-s, --start <blockHeight:timeUnixMs>',
    'block to start computing from (defaults to earliest block)'
  )
  program.option(
    '-u, --start-time <timeUnixMs>',
    'block time to start computing from (if negative, relative to now)',
    (value) => (value ? BigInt(value) : undefined)
  )
  program.option(
    '-e, --end <blockHeight:timeUnixMs>',
    'block to end computing at (defaults to latest block)'
  )
  program.option(
    '-b, --batch <size>',
    'batch size for computing',
    (value) => parseInt(value, 10),
    500000
  )
  program.option(
    '-c, --config <path>',
    'path to config file, falling back to config.json'
  )
  program.parse()
  const options = program.opts()

  // Load config from specific config file.
  ConfigManager.load(options.config)

  let args: Record<string, any> = {}
  if (options.args) {
    if (
      typeof options.args !== 'string' ||
      !options.args.trimStart().startsWith('{')
    ) {
      throw new Error(`Invalid JSON args: ${options.args}`)
    }

    try {
      args = JSON.parse(options.args)
    } catch (err) {
      throw new Error(`Invalid JSON args: ${options.args}. ${err}`)
    }
  }

  const sequelize = await loadDb()
  const state = await State.getSingleton()
  if (!state) {
    throw new Error('No state found.')
  }

  // Set up wasm code service.
  await WasmCodeService.setUpInstance()

  let addresses: string[]

  if (options.targets) {
    addresses = options.targets
  } else if (options.ids?.length || options.codeIdsKeys?.length) {
    const codeIds = [
      ...(options.ids || []),
      ...WasmCodeService.getInstance().findWasmCodeIdsByKeys(
        options.codeIdsKeys || []
      ),
    ]
    addresses = (
      await Contract.findAll({
        where: {
          codeId: codeIds,
        },
      })
    ).map((contract) => contract.address)
  } else {
    throw new Error('Must specify either target addresses or code IDs.')
  }

  if (addresses.length === 0) {
    throw new Error('No addresses found.')
  }

  const blockStart: BlockType | undefined =
    (options.start
      ? validateBlockString(options.start, 'start')
      : options.startTime
      ? (
          await Block.getForTime(
            // Relative if negative.
            options.startTime < 0n
              ? BigInt(Date.now()) + options.startTime
              : options.startTime
          )
        )?.block
      : undefined) || (await Block.getFirst())?.block

  // If blockStart undefined, no events found.
  if (!blockStart) {
    throw new Error('No start block because no events found.')
  }

  const blockEnd: BlockType | undefined = options.end
    ? validateBlockString(options.end, 'end')
    : state?.latestBlock

  // If blockEnd undefined, no state found.
  if (!blockEnd) {
    throw new Error('No state found.')
  }

  const typedFormula = getTypedFormula(
    options.formula.split('/')[0],
    options.formula.split('/').slice(1).join('/')
  )

  const initialStart = new Date()
  console.log(
    `[${initialStart.toLocaleString()}] Computing ${
      options.formula
    } (with args ${JSON.stringify(
      args
    )}) for ${addresses.length.toLocaleString()} address${
      addresses.length === 1 ? '' : 'es'
    } from ${blockStart.height} to ${blockEnd.height}:`
  )
  addresses.forEach((address) => console.log(`  - ${address}`))
  console.log()

  let computations = 0
  for (const targetAddress of addresses) {
    const start = new Date()
    console.log(`[${start.toLocaleString()}] Computing ${targetAddress}...`)

    // Loop in batches.
    let count = 0
    let block = blockStart
    let i = 1
    while (block.height <= blockEnd.height) {
      const endBlockHeight = bigIntMin(
        block.height + BigInt(options.batch),
        blockEnd.height + 1n
      )
      const endBlock = await Block.getForHeight(endBlockHeight, block.height)

      // If no event before end block, we're done.
      if (!endBlock) {
        break
      }

      const outputs = await computeRange({
        ...typedFormula,
        chainId: state.chainId,
        targetAddress,
        args,
        blockStart: block,
        blockEnd: endBlock.block,
      })
      count += outputs.length

      // Store computations in DB.
      if (outputs.length > 0) {
        await Computation.createFromComputationOutputs(
          targetAddress,
          typedFormula,
          args,
          outputs
        )
      }

      console.log(
        `  - Batch ${i} (${block.height}-${
          endBlock.height
        }): ${outputs.length.toLocaleString()}`
      )

      block = endBlock.block
      i++
    }

    computations += count

    const end = new Date()
    console.log(
      `Generated ${count.toLocaleString()} computations in ${(
        (end.getTime() - start.getTime()) /
        1000
      ).toLocaleString()}s.`
    )
    console.log()
  }

  const end = new Date()
  console.log(
    `[${end.toLocaleString()}] Generated ${computations.toLocaleString()} computations in ${(
      (end.getTime() - initialStart.getTime()) /
      1000
    ).toLocaleString()}s.`
  )

  await sequelize.close()
  process.exit(0)
}

main()
