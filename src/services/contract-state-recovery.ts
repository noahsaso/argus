import { fromUtf8 } from '@cosmjs/encoding'
import { Sequelize } from 'sequelize'

import { Block, Contract, State, WasmStateEvent } from '@/db'
import { transformParsedStateEvents } from '@/transformers'
import { ParsedWasmStateEvent } from '@/types'
import { getContractInfo } from '@/utils'

import { FetchPageArgs, FetchPageResult } from './contract-state-dump'

export type ContractStateRecovery = {
  count: number
  events: number
  transformations: number
}

type LatestStateEvent = Pick<WasmStateEvent, 'value' | 'valueJson' | 'delete'>

type RecoverContractStateDeps = {
  ensureContract?: (args: {
    address: string
    codeId: number
    blockHeight: string
    blockTimeUnixMs: string
  }) => Promise<void>
  getLatestEvent?: (
    event: ParsedWasmStateEvent
  ) => Promise<LatestStateEvent | null>
  saveEvents?: (
    events: ParsedWasmStateEvent[]
  ) => Promise<{ contract?: Contract }[]>
  transformEvents?: typeof transformParsedStateEvents
  updateState?: (args: {
    blockHeight: string
    blockTimeUnixMs: string
  }) => Promise<void>
}

const bytesToUtf8 = (value: Uint8Array): string => {
  try {
    return fromUtf8(value)
  } catch {
    return Buffer.from(value).toString('base64')
  }
}

const isJsonEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const isUnchangedLiveState = (
  recoveredEvent: ParsedWasmStateEvent,
  latestEvent: LatestStateEvent
): boolean =>
  !latestEvent.delete &&
  latestEvent.value === recoveredEvent.value &&
  isJsonEqual(latestEvent.valueJson, recoveredEvent.valueJson)

export const recoverContractState = async ({
  address,
  codeId,
  blockHeight,
  blockTimeUnixMs,
  pageLimit,
  fetchPage,
  ensureContract = defaultEnsureContract,
  getLatestEvent = defaultGetLatestEvent,
  saveEvents = defaultSaveEvents,
  transformEvents = transformParsedStateEvents,
  updateState = defaultUpdateState,
}: {
  address: string
  codeId: number
  blockHeight: string
  blockTimeUnixMs: string
  pageLimit: number
  fetchPage: (args: FetchPageArgs) => Promise<FetchPageResult>
} & RecoverContractStateDeps): Promise<ContractStateRecovery> => {
  const blockTimestamp = new Date(Number(blockTimeUnixMs))
  const events: ParsedWasmStateEvent[] = []
  let nextKey: Uint8Array | undefined

  do {
    const page = await fetchPage({ address, pageLimit, nextKey })
    events.push(
      ...page.models.map(({ key, value }) => {
        const valueString = bytesToUtf8(value)
        let valueJson = null
        try {
          valueJson = JSON.parse(valueString)
        } catch {
          // Leave non-JSON values as null, matching wasm event parsing.
        }

        return {
          type: 'state' as const,
          codeId,
          contractAddress: address,
          blockHeight,
          blockTimeUnixMs,
          blockTimestamp,
          key: Array.from(key).join(','),
          value: valueString,
          valueJson,
          delete: false,
        }
      })
    )
    nextKey = page.nextKey && page.nextKey.length > 0 ? page.nextKey : undefined
  } while (nextKey)

  if (!events.length) {
    return { count: 0, events: 0, transformations: 0 }
  }

  const eventsToSave: ParsedWasmStateEvent[] = []
  for (const event of events) {
    const latestEvent = await getLatestEvent(event)
    if (!latestEvent || !isUnchangedLiveState(event, latestEvent)) {
      eventsToSave.push(event)
    }
  }

  if (!eventsToSave.length) {
    return { count: events.length, events: 0, transformations: 0 }
  }

  await ensureContract({ address, codeId, blockHeight, blockTimeUnixMs })
  const savedEvents = await saveEvents(eventsToSave)
  const parsedEvents = eventsToSave.filter((event, index) => {
    const savedEvent = savedEvents[index]
    return savedEvent?.contract !== undefined || event.codeId > 0
  })
  const transformations = await transformEvents(parsedEvents)

  await updateState({ blockHeight, blockTimeUnixMs })

  return {
    count: events.length,
    events: savedEvents.length,
    transformations: transformations.length,
  }
}

export const defaultUpdateState = async ({
  blockHeight,
  blockTimeUnixMs,
}: {
  blockHeight: string
  blockTimeUnixMs: string
}) => {
  await Block.createMany([{ height: blockHeight, timeUnixMs: blockTimeUnixMs }])
  await State.updateSingleton({
    lastWasmBlockHeightExported: Sequelize.fn(
      'GREATEST',
      Sequelize.col('lastWasmBlockHeightExported'),
      blockHeight
    ),
    latestBlockHeight: Sequelize.fn(
      'GREATEST',
      Sequelize.col('latestBlockHeight'),
      blockHeight
    ),
    latestBlockTimeUnixMs: Sequelize.fn(
      'GREATEST',
      Sequelize.col('latestBlockTimeUnixMs'),
      blockTimeUnixMs
    ),
  })
}

export const defaultEnsureContract = async ({
  address,
  codeId,
  blockHeight,
  blockTimeUnixMs,
}: {
  address: string
  codeId: number
  blockHeight: string
  blockTimeUnixMs: string
}) => {
  await Contract.bulkCreate(
    [
      {
        address,
        codeId,
        instantiatedAtBlockHeight: blockHeight,
        instantiatedAtBlockTimeUnixMs: blockTimeUnixMs,
        instantiatedAtBlockTimestamp: new Date(Number(blockTimeUnixMs)),
      },
    ],
    {
      updateOnDuplicate: ['codeId'],
      conflictAttributes: ['address'],
    }
  )
}

export const defaultGetLatestEvent = async ({
  contractAddress,
  key,
}: ParsedWasmStateEvent): Promise<LatestStateEvent | null> =>
  await WasmStateEvent.findOne({
    where: {
      contractAddress,
      key,
    },
    order: [['blockHeight', 'DESC']],
    attributes: ['value', 'valueJson', 'delete'],
  })

export const defaultSaveEvents = async (events: ParsedWasmStateEvent[]) => {
  const savedEvents = await WasmStateEvent.bulkCreate(events, {
    updateOnDuplicate: ['value', 'valueJson', 'delete'],
    conflictAttributes: ['contractAddress', 'key', 'blockHeight'],
  })

  const contracts = await Contract.findAll({
    where: {
      address: [...new Set(events.map((event) => event.contractAddress))],
    },
  })
  const contractMap = Object.fromEntries(
    contracts.map((contract) => [contract.address, contract])
  )

  savedEvents.forEach((event) => {
    event.contract = contractMap[event.contractAddress]
  })

  return savedEvents
}

export const getRecoveryContractInfo = getContractInfo
