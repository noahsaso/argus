import { AutoCosmWasmClient } from '@/utils'

import { Config } from './config'
import { DependableEventModel } from './db'

export type Handler<Data extends unknown = unknown> = {
  // What store name to filter by for events to handle.
  storeName: string
  // The function that will be called for each trace which determines if it will
  // be queued for export. If returns an object, it will be queued. If returns
  // undefined, it will not be queued.
  match: (trace: TracedEventWithBlockTime) =>
    | (Data & {
        // ID that uniquely represents this object. Likely a combination of
        // block height and some key or keys.
        id: string
      })
    | undefined
  // The function that will be called with queued objects. Returns created
  // events.
  process: (data: Data[]) => Promise<DependableEventModel[]>
}

export type HandlerMakerOptions = {
  config: Config
  sendWebhooks: boolean
  autoCosmWasmClient: AutoCosmWasmClient
}

export type HandlerMaker<Data extends unknown = unknown> = (
  options: HandlerMakerOptions
) => Promise<Handler<Data>>

export type NamedHandler = {
  name: string
  handler: Handler
}

export type TracedEvent = {
  operation: 'read' | 'write' | 'delete'
  key: string
  value: string
  metadata: {
    blockHeight: number
    txHash?: string
    store_name?: string
  }
}

export type TracedEventWithBlockTime = TracedEvent & {
  blockTimeUnixMs: number
}

export type ParsedWasmStateEvent = {
  type: 'state'
  codeId: number
  contractAddress: string
  blockHeight: string
  blockTimeUnixMs: string
  blockTimestamp: Date
  key: string
  value: string
  valueJson: any
  delete: boolean
}

export type WasmExportData =
  | {
      type: 'state'
      data: Omit<ParsedWasmStateEvent, 'blockTimestamp'>
    }
  | {
      type: 'contract'
      data: {
        address: string
        codeId: number
        admin: string
        creator: string
        label: string
        blockHeight: string
        blockTimeUnixMs: string
      }
    }

export type ParsedGovStateEvent =
  | {
      type: 'proposal'
      data: {
        proposalId: string
        blockHeight: string
        blockTimeUnixMs: string
        blockTimestamp: Date
        data: string
      }
    }
  | {
      type: 'vote'
      data: {
        proposalId: string
        voterAddress: string
        blockHeight: string
        blockTimeUnixMs: string
        blockTimestamp: Date
        data: string
      }
    }

export type ParsedDistributionCommunityPoolStateEvent = {
  blockHeight: string
  blockTimeUnixMs: string
  blockTimestamp: Date
  // Map denom to balance.
  balances: Record<string, string>
}

export type ParsedBankStateEvent = {
  address: string
  blockHeight: string
  blockTimeUnixMs: string
  blockTimestamp: Date
  denom: string
  balance: string
}

export type ParsedFeegrantStateEvent = {
  granter: string
  grantee: string
  blockHeight: string
  blockTimeUnixMs: string
  blockTimestamp: Date
  allowanceData: string
  allowanceType: string | null
  active: boolean
}
