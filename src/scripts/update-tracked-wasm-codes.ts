import { Command } from 'commander'
import { Op } from 'sequelize'

import { ConfigManager } from '@/config'
import { Contract, State, loadDb } from '@/db'
import { DbType } from '@/types'
import { WasmCodeTrackerManager } from '@/wasmCodeTrackers'

const main = async () => {
  // Parse arguments.
  const { config: _config } = new Command('update-tracked-wasm-codes')
    .description('Find and update all tracked WASM codes.')
    .option(
      '-c, --config <path>',
      'path to config file, falling back to config.json'
    )
    .parse()
    .opts()

  // Load config from specific config file.
  ConfigManager.load(_config)

  // Load DB on start.
  const sequelize = await loadDb({
    type: DbType.Data,
  })

  // Get chain ID.
  const chainId = (await State.getSingleton())?.chainId
  if (!chainId) {
    throw new Error('Chain ID not found')
  }

  // Get wasm code tracker manager for this chain.
  const manager = new WasmCodeTrackerManager(chainId)
  if (manager.hasTrackers) {
    // Get all tracked state events.
    console.log(
      `\n[${new Date().toLocaleString()}] Getting all tracked state events...`
    )
    const trackedStateEvents = await manager.getTrackedStateEvents()

    const uniqueContractAddresses = [
      ...new Set([...trackedStateEvents.map((c) => c.contractAddress)]),
    ]

    const contracts = await Contract.findAll({
      where: {
        address: uniqueContractAddresses,
        codeId: {
          [Op.gt]: 0,
        },
      },
    })

    console.log(
      `[${new Date().toLocaleString()}] Found ${contracts.length.toLocaleString()} contracts to potentially track.`
    )

    // Track codes.
    await manager.trackCodes(contracts)
    console.log(`[${new Date().toLocaleString()}] Done!`)
  } else {
    console.log(`[${new Date().toLocaleString()}] No trackers found.`)
  }

  // Close DB connection.
  await sequelize.close()

  process.exit(0)
}

main()
