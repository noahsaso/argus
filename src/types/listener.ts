import { Event } from '@cosmjs/stargate'
import { DecodedStargateMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'

import { AutoCosmWasmClient } from '@/utils'

import { Config } from './config'
import { DependableEventModel } from './db'
import { SerializedBlock } from './misc'

export type ExtractorMatchInput = {
  hash: string
  tx: Tx
  messages: DecodedStargateMsg['stargate'][]
  events: readonly Event[]
}

export type ExtractorExtractInput<Data extends unknown = unknown> = {
  txHash: string
  block: SerializedBlock
  data: Data
}

export type Extractor<Data extends unknown = unknown> = {
  // The function that will be called for each TX which determines if it will be
  // queued for extraction. If returns an object, it will be queued. If returns
  // undefined, it will not be queued.
  match: (input: ExtractorMatchInput) => Data | undefined
  // The function that will be called with queued objects. Returns created
  // events.
  extract: (
    input: ExtractorExtractInput<Data>
  ) => Promise<DependableEventModel[]>
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
