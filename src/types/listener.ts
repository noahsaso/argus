import { DecodedStargateMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'

import { TxResult } from '@/services/ChainWebSocketListener'
import { AutoCosmWasmClient } from '@/utils'

import { Config } from './config'
import { DependableEventModel } from './db'

export type ExtractorInput = {
  hash: string
  tx: Tx
  messages: DecodedStargateMsg['stargate'][]
  events: TxResult['result']['events']
}

export type Extractor<Data extends unknown = unknown> = {
  // The function that will be called for each TX which determines if it will be
  // queued for extraction. If returns an object, it will be queued. If returns
  // undefined, it will not be queued.
  match: (input: ExtractorInput) => Data | undefined
  // The function that will be called with queued objects. Returns created
  // events.
  extract: (data: Data[]) => Promise<DependableEventModel[]>
}

export type ExtractorMakerOptions = {
  config: Config
  sendWebhooks: boolean
  autoCosmWasmClient: AutoCosmWasmClient
}

export type ExtractorMaker<Data extends unknown = unknown> = (
  options: ExtractorMakerOptions
) => Promise<Extractor<Data>>

export type NamedExtractor = {
  name: string
  extractor: Extractor
}
