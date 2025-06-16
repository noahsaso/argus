import { fromBase64, fromUtf8, toBech32 } from '@cosmjs/encoding'
import { ContractInfo } from '@dao-dao/types/protobuf/codegen/cosmwasm/wasm/v1/types'
import * as Sentry from '@sentry/node'
import retry from 'async-await-retry'
import { LRUCache } from 'lru-cache'
import { Sequelize } from 'sequelize'

import {
  AccountWebhook,
  Block,
  Contract,
  State,
  WasmStateEvent,
  WasmStateEventTransformation,
} from '@/db'
import { WasmCodeTrackersQueue } from '@/queues/queues'
import { WasmCodeService } from '@/services'
import { transformParsedStateEvents } from '@/transformers'
import {
  Handler,
  HandlerMaker,
  ParsedWasmStateEvent,
  WasmExportData,
} from '@/types'
import { dbKeyForKeys } from '@/utils'

const STORE_NAME = 'wasm'
const DEFAULT_CONTRACT_BYTE_LENGTH = 32

// Only save specific state events for contracts matching these code IDs keys.
const CONTRACT_STATE_EVENT_KEY_ALLOWLIST: Partial<
  Record<
    string,
    {
      codeIdsKeys: string[]
      stateKeys: string[]
    }[]
  >
> = {
  'kaiyo-1': [
    {
      codeIdsKeys: ['kujira-fin'],
      stateKeys: ['contract_info'],
    },
  ],
  'osmosis-1': [
    {
      codeIdsKeys: [
        'levana-finance',
        'cl-vault',
        'icns-resolver',
        'skip-api',
        'calc-dca',
        'rate-limiter',
      ],
      stateKeys: ['contract_info'],
    },
  ],
}

export const wasm: HandlerMaker<WasmExportData> = async ({
  config: { bech32Prefix },
  sendWebhooks,
  autoCosmWasmClient,
}) => {
  const chainId =
    autoCosmWasmClient.chainId || (await State.getSingleton())?.chainId
  if (!chainId) {
    throw new Error(
      'Chain ID needed for wasm export, failed to load from RPC or State model in DB.'
    )
  }

  const isTerraClassic = chainId === 'columbus-5'

  // Terra Classic uses different prefixes:
  // https://github.com/classic-terra/wasmd/blob/v0.30.0-terra.3/x/wasm/types/keys.go#L31-L32
  const CONTRACT_KEY_PREFIX = isTerraClassic ? 0x04 : 0x02
  const CONTRACT_STORE_PREFIX = isTerraClassic ? 0x05 : 0x03

  // Get the contract state event allowlist.
  const stateEventAllowlist = CONTRACT_STATE_EVENT_KEY_ALLOWLIST[chainId]?.map(
    ({ codeIdsKeys, stateKeys }) => ({
      codeIdsKeys,
      stateKeys: stateKeys.map((key) => dbKeyForKeys(key)),
    })
  )

  // Get code ID for contract, cached in memory.
  const codeIdCache = new LRUCache<string, number>({
    max: 1000,
  })
  const getCodeId = async (contractAddress: string): Promise<number> => {
    if (codeIdCache.has(contractAddress)) {
      return codeIdCache.get(contractAddress) ?? 0
    }

    const loadIntoCache = async () => {
      let codeId = 0
      try {
        if (autoCosmWasmClient.client) {
          codeId = (
            await autoCosmWasmClient.client.getContract(contractAddress)
          ).codeId
        } else {
          throw new Error(
            `CosmWasm client not connected, cannot get code ID for ${contractAddress}.`
          )
        }
      } catch (err) {
        // If contract not found, ignore, leaving as 0. Otherwise, throw err.
        if (
          !(err instanceof Error) ||
          !err.message.includes('not found: invalid request')
        ) {
          throw err
        }
      }

      codeIdCache.set(contractAddress, codeId)
    }

    try {
      // Retry 3 times with exponential backoff starting at 100ms delay.
      await retry(loadIntoCache, [], {
        retriesMax: 3,
        exponential: true,
        interval: 100,
      })
    } catch (err) {
      console.error(
        '-------\nFailed to get code ID:\n',
        err instanceof Error ? err.message : err,
        '\nContract: ' + contractAddress + '\n-------'
      )
      Sentry.captureException(err, {
        tags: {
          type: 'failed-get-code-id',
          script: 'export',
          handler: 'wasm',
          chainId,
          contractAddress,
        },
      })

      // Set to 0 on failure so we can continue.
      codeIdCache.set(contractAddress, 0)
    }

    return codeIdCache.get(contractAddress) ?? 0
  }

  const match: Handler<WasmExportData>['match'] = (trace) => {
    // Format most wasm chains...
    //
    //   wasm keys:
    //
    //     ContractStorePrefix || contractAddressBytes || keyBytes
    //
    //   contract info keys:
    //
    //     ContractKeyPrefix || contractAddressBytes
    //
    // Terra Classic includes length prefixes:
    // https://github.com/classic-terra/wasmd/blob/v0.30.0-terra.3/x/wasm/types/keys.go#L46-L60
    //
    //   wasm keys:
    //
    //     ContractStorePrefix || contractAddressLength || contractAddressBytes || keyBytes
    //
    //   contract info keys:
    //
    //     ContractKeyPrefix || contractAddressLength || contractAddressBytes

    const keyData = fromBase64(trace.key)
    if (
      keyData[0] !== CONTRACT_STORE_PREFIX &&
      keyData[0] !== CONTRACT_KEY_PREFIX
    ) {
      return
    }

    const contractByteLength = isTerraClassic
      ? keyData[1]
      : DEFAULT_CONTRACT_BYTE_LENGTH
    // Start of contract address in the key, taking into account the prefix.
    // Terra Classic has an additional byte for the contract length.
    const contractAddressOffset = isTerraClassic ? 2 : 1

    // Ignore keys that are too short to be a wasm key.
    if (keyData.length < contractAddressOffset + contractByteLength) {
      return
    }

    const contractAddress = toBech32(
      bech32Prefix,
      keyData.slice(
        contractAddressOffset,
        contractAddressOffset + contractByteLength
      )
    )
    // Convert key to comma-separated list of bytes. See explanation in `Event`
    // model for more information.
    const key = keyData
      .slice(contractAddressOffset + contractByteLength)
      .join(',')

    // Get code ID and block timestamp from chain.
    const blockHeight = BigInt(trace.metadata.blockHeight).toString()
    const blockTimeUnixMs = BigInt(trace.blockTimeUnixMs).toString()

    // If contract key, save contract info.
    if (trace.operation === 'write' && keyData[0] === CONTRACT_KEY_PREFIX) {
      // Parse as protobuf to get code ID.
      const protobufContractInfo = fromBase64(trace.value)
      let contractInfo
      try {
        contractInfo = ContractInfo.decode(protobufContractInfo)
      } catch (err) {
        // If failed to decode, not contract info.
        return
      }

      if (!contractInfo.codeId) {
        // If no code ID found in JSON, ignore.
        return
      }

      return {
        id: ['contract', blockHeight, contractAddress].join(':'),
        type: 'contract',
        data: {
          address: contractAddress,
          codeId: Number(contractInfo.codeId),
          admin: contractInfo.admin,
          creator: contractInfo.creator,
          label: contractInfo.label,
          blockHeight,
          blockTimeUnixMs,
        },
      }
    }

    // Otherwise, save state event.

    // Convert base64 value to utf-8 string, if present.
    let value
    try {
      value = trace.value && fromUtf8(fromBase64(trace.value))
    } catch (err) {
      // Ignore decoding errors.
      value = trace.value
    }

    let valueJson = null
    if (trace.operation !== 'delete' && value) {
      try {
        valueJson = JSON.parse(value ?? 'null')
      } catch {
        // Ignore parsing errors.
      }
    }

    return {
      id: ['state', blockHeight, contractAddress, key].join(':'),
      type: 'state',
      data: {
        type: 'state',
        // Initialize the code ID to 0 since we don't know it yet. It will be
        // retrieved later.
        codeId: 0,
        contractAddress,
        blockHeight,
        blockTimeUnixMs,
        key,
        value,
        valueJson,
        delete: trace.operation === 'delete',
      },
    }
  }

  const process: Handler<WasmExportData>['process'] = async (events) => {
    // Save blocks from events.
    await Block.createMany(
      [...new Set(events.map((e) => e.data.blockHeight))].map((height) => ({
        height,
        timeUnixMs: events.find((e) => e.data.blockHeight === height)!.data
          .blockTimeUnixMs,
      }))
    )

    // Export contracts.
    const contractEvents = events.flatMap((event) =>
      event.type === 'contract' ? event.data : []
    )
    if (contractEvents.length > 0) {
      await Contract.bulkCreate(
        contractEvents.map(
          ({
            address,
            codeId,
            admin,
            creator,
            label,
            blockHeight,
            blockTimeUnixMs,
          }) => ({
            address,
            codeId,
            admin,
            creator,
            label,
            instantiatedAtBlockHeight: blockHeight,
            instantiatedAtBlockTimeUnixMs: blockTimeUnixMs,
            instantiatedAtBlockTimestamp: new Date(Number(blockTimeUnixMs)),
          })
        ),
        {
          updateOnDuplicate: ['codeId', 'admin', 'creator', 'label'],
        }
      )
    }

    // Export state.
    let stateEvents = events.flatMap((event) =>
      event.type === 'state' ? event.data : []
    )

    // Attempt to track code keys based on BOTH contract and state event
    // updates, since a contract may be instantiated in the same block it sets
    // tracked state keys.
    if (contractEvents.length > 0) {
      WasmCodeTrackersQueue.add(contractEvents[0].blockHeight, {
        contractEvents,
        stateEventUpdates: stateEvents,
      })
    }

    if (!stateEvents.length) {
      return []
    }

    stateEvents = stateEvents.map(
      (e): ParsedWasmStateEvent => ({
        ...e,
        blockTimestamp: new Date(Number(e.blockTimeUnixMs)),
      })
    )

    const state = await State.getSingleton()
    if (!state) {
      throw new Error('State not found while exporting.')
    }

    const uniqueContracts = [
      ...new Set(stateEvents.map((stateEvent) => stateEvent.contractAddress)),
    ]

    const exportContractsAndEvents = async () => {
      // Ensure contract exists before creating events. `address` is unique.
      await Contract.bulkCreate(
        uniqueContracts.map((address) => {
          const event = stateEvents.find(
            (event) => event.contractAddress === address
          )
          // Should never happen since `uniqueContracts` is derived from
          // `parsedEvents`.
          if (!event) {
            throw new Error('Event not found when creating contract.')
          }

          return {
            address,
            // Initialize the code ID to 0 since we don't know it here. It will
            // be retrieved below if it doesn't already exist in the database.
            codeId: 0,
            // Set the contract instantiation block to the first event found in
            // the list of parsed events. Events are sorted in ascending order
            // by creation block. These won't get updated if the contract
            // already exists, so it's safe to always attempt creation with the
            // first event's block.
            instantiatedAtBlockHeight: event.blockHeight,
            instantiatedAtBlockTimeUnixMs: event.blockTimeUnixMs,
            instantiatedAtBlockTimestamp: new Date(
              Number(event.blockTimeUnixMs)
            ),
          }
        }),
        {
          // Do nothing if contract already exists.
          ignoreDuplicates: true,
        }
      )

      let contracts = await Contract.findAll({
        where: {
          address: uniqueContracts,
        },
      })

      // Try to retrieve code IDs for contracts with 0 or -1 code IDs.
      const contractsToGetCodeId = contracts.filter(
        (contract) => contract.codeId <= 0
      )
      // Update code IDs for contracts with missing code IDs.
      if (contractsToGetCodeId.length > 0) {
        const codeIds = await Promise.all(
          contractsToGetCodeId.map((contract) => getCodeId(contract.address))
        )

        await Contract.bulkCreate(
          contractsToGetCodeId
            .map((contract, index) => ({
              ...contract.toJSON(),
              codeId: codeIds[index],
            }))
            .filter(({ codeId }) => codeId > 0),
          {
            updateOnDuplicate: ['codeId'],
          }
        )

        // Get updated contracts.
        contracts = await Contract.findAll({
          where: {
            address: uniqueContracts,
          },
        })
      }

      const allowlist = stateEventAllowlist
        ?.map(({ codeIdsKeys, ...rest }) => ({
          ...rest,
          codeIds: WasmCodeService.getInstance().findWasmCodeIdsByKeys(
            ...codeIdsKeys
          ),
        }))
        .filter(({ codeIds }) => codeIds.length > 0)

      // Keep events for contracts that do not exist in the allowlist or whose
      // state keys are not in the allowlist.
      if (allowlist?.length) {
        stateEvents = stateEvents.filter((event) => {
          const codeId = contracts.find(
            (contract) => contract.address === event.contractAddress
          )?.codeId

          return (
            !codeId ||
            !allowlist.some(
              ({ codeIds, stateKeys }) =>
                codeIds.includes(codeId) && !stateKeys.includes(event.key)
            )
          )
        })
      }

      // Unique index on [blockHeight, contractAddress, key] ensures that we
      // don't insert duplicate events. If we encounter a duplicate, we update
      // the `value`, `valueJson`, and `delete` fields in case event processing
      // for a block was batched separately.
      const events = await WasmStateEvent.bulkCreate(stateEvents, {
        updateOnDuplicate: ['value', 'valueJson', 'delete'],
      })

      return {
        contracts,
        events,
      }
    }

    // Retry 3 times with exponential backoff starting at 100ms delay.
    let { contracts, events: exportedEvents } = (await retry(
      exportContractsAndEvents,
      [],
      {
        retriesMax: 3,
        exponential: true,
        interval: 100,
      }
    )) as {
      contracts: Contract[]
      events: WasmStateEvent[]
    }

    // Add contract to events.
    await Promise.all(
      exportedEvents.map(async (event) => {
        let contract = contracts.find(
          (contract) => contract.address === event.contractAddress
        )
        // Fetch contract if it wasn't found.
        let missingContract = false
        if (!contract) {
          contract = (await event.$get('contract')) ?? undefined
          missingContract = true
        }

        if (contract) {
          if (missingContract) {
            // Save for other events.
            contracts.push(contract)
          }

          event.contract = contract
        }
      })
    )

    // Add code ID to parsed events.
    stateEvents.forEach((stateEvent) => {
      const contract = contracts.find(
        (contract) => contract.address === stateEvent.contractAddress
      )
      if (contract) {
        stateEvent.codeId = contract.codeId
      }
    })

    // Remove events that don't have a contract or code ID.
    exportedEvents = exportedEvents.filter(
      (event) => event.contract !== undefined
    )
    stateEvents = stateEvents.filter((stateEvent) => stateEvent.codeId > 0)

    // Transform events as needed.
    // Retry 3 times with exponential backoff starting at 100ms delay.
    const transformations = (await retry(
      transformParsedStateEvents,
      [stateEvents],
      {
        retriesMax: 3,
        exponential: true,
        interval: 100,
      }
    )) as WasmStateEventTransformation[]

    // Add contract to transformations.
    await Promise.all(
      transformations.map(async (transformation) => {
        let contract = contracts.find(
          (contract) => contract.address === transformation.contractAddress
        )
        // Fetch contract if it wasn't found.
        let missingContract = false
        if (!contract) {
          contract = (await transformation.$get('contract')) ?? undefined
          missingContract = true
        }

        if (contract) {
          if (missingContract) {
            // Save for other transformations.
            contracts.push(contract)
          }

          transformation.contract = contract
        }
      })
    )

    const createdEvents = [...exportedEvents, ...transformations]

    // Queue webhooks as needed.
    if (sendWebhooks) {
      // Don't queue webhooks for events before `lastWasmBlockHeightExported` to
      // ensure that webhooks aren't sent more than once if we're catching up
      // from a block we already processed. This happens when  restoring from an
      // earlier snapshot, likely due to an error or to save space.
      const potentialUnsentWebhookEvents = exportedEvents.filter(
        (e) =>
          // Include events on the last block we exported in case events from
          // the same block were exported in separate batches and thus processed
          // separately.
          e.block.height >= BigInt(state.lastWasmBlockHeightExported || '0')
      )
      if (potentialUnsentWebhookEvents.length > 0) {
        await AccountWebhook.queueWebhooks(potentialUnsentWebhookEvents)
      }
    }

    // Store last block height exported, and update latest block
    // height/time if the last export is newer.
    const lastEvent = events.sort(
      (a, b) => Number(a.data.blockHeight) - Number(b.data.blockHeight)
    )[events.length - 1]
    const lastBlockHeightExported = lastEvent.data.blockHeight
    const lastBlockTimeUnixMsExported = lastEvent.data.blockTimeUnixMs
    await State.updateSingleton({
      lastWasmBlockHeightExported: Sequelize.fn(
        'GREATEST',
        Sequelize.col('lastWasmBlockHeightExported'),
        lastBlockHeightExported
      ),

      latestBlockHeight: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockHeight'),
        lastBlockHeightExported
      ),
      latestBlockTimeUnixMs: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockTimeUnixMs'),
        lastBlockTimeUnixMsExported
      ),
    })

    return createdEvents
  }

  return {
    storeName: STORE_NAME,
    match,
    process,
  }
}
