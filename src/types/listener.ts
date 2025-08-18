import { Event } from '@cosmjs/stargate'
import { DecodedStargateMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'

import { AutoCosmWasmClient } from '@/utils'

import { Config } from './config'
import { ExtractionJson } from './db'
import { SerializedBlock } from './misc'

/**
 * Passed to each data source to match and extract data.
 */
export type ExtractableTxInput = {
  hash: string
  tx: Tx
  messages: DecodedStargateMsg['stargate'][]
  events: readonly Event[]
}

/**
 * The environment for each extractor.
 */
export type ExtractorEnv = {
  config: Config
  txHash: string
  block: SerializedBlock
  autoCosmWasmClient: AutoCosmWasmClient
  sendWebhooks: boolean
}

/**
 * The sync environment for each extractor.
 */
export type ExtractorSyncEnv = {
  config: Config
  autoCosmWasmClient: AutoCosmWasmClient
}

/**
 * A data source configuration for an extractor.
 */
export type ExtractorDataSource<
  Config extends Record<string, unknown> = Record<string, unknown>
> = {
  /**
   * The type of the source.
   */
  type: string
  /**
   * The name of the handler function to call with the data.
   */
  handler: string
  /**
   * The config for the source.
   */
  config: Config
}

/**
 * The output of an extractor handler, to be saved as an extraction in the DB.
 */
export type ExtractorHandlerOutput = Pick<
  ExtractionJson,
  'address' | 'name' | 'data'
>

/**
 * The handler function for an extractor.
 */
export type ExtractorHandler<Data extends unknown = unknown> = (
  data: Data
) => Promise<ExtractorHandlerOutput[]>

/**
 * The data filtered by a data source to be passed to
 */
export type ExtractorData<Data extends unknown = unknown> = {
  type: string
  data: Data
}

/**
 * The data that has been matched by a data source and is ready to be passed to
 * an extractor handler.
 */
export type ExtractorHandleableData<Data extends unknown = unknown> = {
  source: string
  handler: string
  data: Data
}
