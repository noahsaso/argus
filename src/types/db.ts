import { WhereOptions } from 'sequelize'
import { Model } from 'sequelize-typescript'

import { ComputationDependentKey } from './computation'
import { Block, SerializedBlock } from './misc'

export enum DbType {
  Accounts = 'accounts',
  Data = 'data',
}

// If you're adding a new dependable event, you must add a unique namespace to
// this enum. This namespace will be used to identify the type of event in the
// dependent key. ALSO DON'T FORGET TO ADD YOUR MODEL TO THE
// `getDependableEventModels` FUNCTION IN `src/db/utils.ts`.
export enum DependentKeyNamespace {
  WasmStateEvent = 'wasm_state',
  WasmStateEventTransformation = 'wasm_state_transformation',
  WasmTxEvent = 'wasm_tx',
  StakingSlash = 'staking_slash',
  BankDenomBalance = 'bank_denom_balance',
  BankStateEvent = 'bank_state',
  GovProposal = 'gov_proposal',
  GovProposalVote = 'gov_proposal_vote',
  DistributionCommunityPoolStateEvent = 'distribution_community_pool_state',
  Extraction = 'extraction',
  FeegrantAllowance = 'feegrant_allowance',
}

// Interface that event models must implement to be depended on by computations.
export abstract class DependableEventModel extends Model {
  // The namespace for dependent keys from this event. Must be unique across all
  // types of dependable events.
  static dependentKeyNamespace: DependentKeyNamespace
  // The key that stores the block height
  static blockHeightKey: string
  // The key that stores the block time in unix milliseconds
  static blockTimeUnixMsKey: string
  // A function that returns a where clause that will match all events that are
  // described by the dependent keys.
  static getWhereClauseForDependentKeys(
    _dependentKeys: ComputationDependentKey[]
  ): WhereOptions<any> {
    throw new Error('Not implemented')
  }
  // A getter that returns a unique dependent key based on this event's
  // properties.
  abstract get dependentKey(): string
  // A getter that returns the block.
  abstract get block(): Block
  /**
   * A function to fetch the previous event based on the current event.
   */
  async getPreviousEvent(_cache = true): Promise<DependableEventModel | null> {
    throw new Error('Not implemented')
  }
}

export type ContractJson = {
  address: string
  codeId: number
  admin?: string | null
  creator?: string | null
  label?: string | null
  instantiatedAt?: SerializedBlock | null
  txHash?: string | null
}

export type FeegrantAllowanceJson = {
  granter: string
  grantee: string
  allowanceData: string
  allowanceType: string | null
  active: boolean
  block: SerializedBlock
}

export type ExtractionJson = {
  address: string
  name: string
  blockHeight: string
  blockTimeUnixMs: string
  txHash: string
  data: unknown
}
