import {
  ProposalStatus,
  VoteOption,
  WeightedVoteOption,
} from '@dao-dao/types/protobuf/codegen/cosmos/gov/v1/gov'
import { OpenAPIV3_1 } from 'openapi-types'
import { BindOrReplacements, WhereOptions } from 'sequelize'

import type { Contract, StakingSlashEvent, WasmTxEvent } from '@/db'

import { ComputationDependentKey } from './computation'
import { ContractJson, DependableEventModel } from './db'
import { Block, RequireAtLeastOne } from './misc'

export type KeyInput = string | number | Uint8Array
export type KeyInputType = 'string' | 'number' | 'bytes'

export type FormulaGetter = <T>(
  contractAddress: string,
  ...keys: KeyInput[]
) => Promise<T | undefined>

export type FormulaPrefetch = (
  contractAddress: string,
  ...listOfKeys: (
    | KeyInput
    | {
        keys: KeyInput[]
        map?: boolean
      }
  )[]
) => Promise<void>

export type FormulaMapGetter = <
  K extends string | number = string | number,
  V = any
>(
  contractAddress: string,
  name: string | KeyInput[],
  options?: {
    // Default: 'string'. If 'string', the map key will be decoded assuming it's
    // a utf-8 string. If 'number', the map key will be decoded assuming it's a
    // big-endian integer. If 'raw', the map key will not be decoded and left in
    // the string format of comma-separated integers that represent uint8s. The
    // 'string' and 'number' decodings use `dbKeyToKeys` assuming only one key.
    keyType?: 'string' | 'number' | 'raw'
  }
) => Promise<Record<K, V> | undefined>

export type FormulaDateGetter = (
  ...parameters: Parameters<FormulaGetter>
) => Promise<Date | undefined>

export type FormulaDateWithValueMatchGetter = (
  contractAddress: string,
  keys: KeyInput[],
  whereClause: any
) => Promise<Date | undefined>

export type FormulaTransformationMatchesGetter = <T>(
  contractAddress: string | undefined,
  nameLike: string,
  // TODO(cache): figure out how this fits into the dependent key caching system
  whereClause?: any,
  whereCodeId?: number[],
  // TODO(cache): figure out how this fits into the dependent key caching system
  whereName?: any,
  // TODO(cache): figure out how this fits into the dependent key caching system
  limit?: number
) => Promise<
  | {
      block: Block
      contractAddress: string
      codeId: number
      name: string
      value: T
    }[]
  | undefined
>

export type FormulaTransformationMatchGetter = <T>(
  ...args: Parameters<FormulaTransformationMatchesGetter>
) => Promise<
  | { contractAddress: string; codeId: number; name: string; value: T }
  | undefined
>

export type FormulaTransformationDateGetter = (
  ...parameters: Parameters<FormulaTransformationMatchGetter>
) => Promise<Date | undefined>

export type FormulaTransformationMapGetter = <V = any>(
  contractAddress: string,
  namePrefix: string
) => Promise<Record<string, V> | undefined>

export type FormulaPrefetchTransformations = (
  contractAddress: string,
  // Names must not contain wildcards.
  listOfNames: (
    | string
    | {
        name: string
        map: true
      }
  )[]
) => Promise<void>

export type FormulaContractGetter = (
  contractAddress: string,
  /**
   * Optionally only return a contract if it matches one of the code IDs or
   * keys.
   */
  codeIdsKeysFilter?: string[]
) => Promise<ContractJson | undefined>

export type FormulaContractCodeIdGetter = (
  ...params: Parameters<FormulaContractGetter>
) => Promise<number | undefined>

export type FormulaCodeIdsForKeysGetter = (...keys: string[]) => number[]

export type FormulaContractMatchesCodeIdKeysGetter = (
  contractAddress: string,
  ...keys: string[]
) => Promise<boolean>

export type FormulaCodeIdKeyForContractGetter = (
  contractAddress: string
) => Promise<string | undefined>

export type FormulaSlashEventsGetter = (
  validatorOperatorAddress: string
) => Promise<
  | Pick<
      StakingSlashEvent,
      | 'validatorOperatorAddress'
      | 'registeredBlockHeight'
      | 'registeredBlockTimeUnixMs'
      | 'registeredBlockTimestamp'
      | 'infractionBlockHeight'
      | 'slashFactor'
      | 'amountSlashed'
      | 'effectiveFraction'
      | 'stakedTokensBurned'
    >[]
  | undefined
>

export type FormulaTxEventsGetter = (
  contractAddress: string,
  where?: WhereOptions<WasmTxEvent>
) => Promise<
  | Pick<
      WasmTxEvent,
      | 'blockHeight'
      | 'blockTimeUnixMs'
      | 'blockTimestamp'
      | 'contractAddress'
      | 'action'
      | 'sender'
      | 'msgJson'
      | 'funds'
      | 'response'
    >[]
  | undefined
>

export type FormulaBalanceGetter = (
  address: string,
  denom: string
) => Promise<string | undefined>

export type FormulaBalancesGetter = (
  address: string
) => Promise<Record<string, string> | undefined>

export type FormulaCommunityPoolBalancesGetter = () => Promise<
  Record<string, string> | undefined
>

export type FormulaProposalObject = {
  id: string
  data: string
}

export type FormulaDecodedProposalObject = {
  id: number
  data: string
  title: string
  description: string
  status: ProposalStatus
  submitTime?: number
  depositEndTime?: number
  votingStartTime?: number
  votingEndTime?: number
}

export type FormulaProposalVoteObject = {
  id: string
  voter: string
  data: string
}

export type FormulaDecodedProposalVoteObject = {
  id: number
  voter: string
  data: string
  /**
   * If only one full-weight vote cast, this will be the chosen option.
   */
  vote?: VoteOption
  /**
   * All weighted votes.
   */
  weightedOptions: WeightedVoteOption[]
  /**
   * V1 votes may have metadata attached.
   */
  metadata?: string
}

export type FormulaProposalGetter = (
  proposalId: string
) => Promise<FormulaProposalObject | undefined>

export type FormulaProposalsGetter = (
  ascending?: boolean,
  limit?: number,
  offset?: number
) => Promise<FormulaProposalObject[] | undefined>

export type FormulaProposalCountGetter = () => Promise<number>

export type FormulaProposalVoteGetter = (
  proposalId: string,
  voter: string
) => Promise<FormulaProposalVoteObject | undefined>

export type FormulaProposalVotesGetter = (
  proposalId: string,
  ascending?: boolean,
  limit?: number,
  offset?: number
) => Promise<FormulaProposalVoteObject[] | undefined>

export type FormulaProposalVoteCountGetter = (
  proposalId: string
) => Promise<number>

export type FormulaQuerier = (
  query: string,
  bindParams?: BindOrReplacements
) => Promise<Record<string, unknown>[]>

export type Env<Args extends Record<string, string> = {}> = {
  chainId: string
  block: Block
  /**
   * If latest block is being used, this will be the current date. If fetching
   * at a specific block, this will be the date of that block.
   */
  date: Date
  /**
   * Arguments may or may not be present, so force formula to handle undefined.
   */
  args: Partial<Args>

  get: FormulaGetter
  getMap: FormulaMapGetter
  getDateKeyModified: FormulaDateGetter
  getDateKeyFirstSet: FormulaDateGetter
  getDateKeyFirstSetWithValueMatch: FormulaDateWithValueMatchGetter
  getTransformationMatch: FormulaTransformationMatchGetter
  getTransformationMatches: FormulaTransformationMatchesGetter
  getTransformationMap: FormulaTransformationMapGetter
  getDateFirstTransformed: FormulaTransformationDateGetter
  prefetch: FormulaPrefetch
  prefetchTransformations: FormulaPrefetchTransformations
  getContract: FormulaContractGetter
  getCodeIdsForKeys: FormulaCodeIdsForKeysGetter
  contractMatchesCodeIdKeys: FormulaContractMatchesCodeIdKeysGetter
  getCodeIdKeyForContract: FormulaCodeIdKeyForContractGetter
  getSlashEvents: FormulaSlashEventsGetter
  getTxEvents: FormulaTxEventsGetter
  getBalance: FormulaBalanceGetter
  getBalances: FormulaBalancesGetter
  getProposal: FormulaProposalGetter
  getProposals: FormulaProposalsGetter
  getProposalCount: FormulaProposalCountGetter
  getProposalVote: FormulaProposalVoteGetter
  getProposalVotes: FormulaProposalVotesGetter
  getProposalVoteCount: FormulaProposalVoteCountGetter
  getCommunityPoolBalances: FormulaCommunityPoolBalancesGetter

  /**
   * Raw database query. This cannot be cached, so any formula that uses this
   * should be marked as `dynamic`.
   */
  query: FormulaQuerier
}

export type EnvOptions = {
  chainId: string
  block: Block
  /**
   * If latest block is being used, this will be false. If fetching at a
   * specific block, this will be true.
   */
  useBlockDate?: boolean

  args?: Record<string, any>
  dependentKeys?: ComputationDependentKey[]
  onFetch?: (events: DependableEventModel[]) => void | Promise<void>
  cache?: Partial<Cache>
}

export type AccountEnv<Args extends Record<string, string> = {}> = Env<Args> & {
  address: string
}

export type ContractEnv<Args extends Record<string, string> = {}> =
  Env<Args> & {
    contractAddress: string
  }

export type ValidatorEnv<Args extends Record<string, string> = {}> =
  Env<Args> & {
    validatorOperatorAddress: string
  }

/**
 * Formulas compute a value for the state at one block height.
 */
export type Formula<R = any, E extends Env = Env> = {
  compute: (env: E) => Promise<R>
  /**
   * If true, the formula is non-deterministic within the same block, so it
   * cannot be cached. This likely means that some expiration is being checked
   * based on the latest time, which affects the output of the formula without
   * any state changing.
   */
  dynamic?: boolean
  /**
   * Docs for the formula.
   */
  docs: {
    /**
     * Formula description.
     */
    description: string
    /**
     * Argument definitions.
     */
    args?: Omit<OpenAPIV3_1.ParameterObject, 'in'>[]
  }
}

export type AccountFormula<
  R = any,
  Args extends Record<string, string> = {}
> = Formula<R, AccountEnv<Args>>

export type ContractFormula<
  R = any,
  Args extends Record<string, string> = {}
> = Formula<R, ContractEnv<Args>> & {
  /**
   * If filters not satisfied, returns a 405 status.
   */
  filter?: RequireAtLeastOne<{
    codeIdsKeys: string[]
  }>
}

export type GenericFormula<
  R = any,
  Args extends Record<string, string> = {}
> = Formula<R, Env<Args>>

export type ValidatorFormula<
  R = any,
  Args extends Record<string, string> = {}
> = Formula<R, ValidatorEnv<Args>>

export enum FormulaType {
  Account = 'account',
  Contract = 'contract',
  Generic = 'generic',
  Validator = 'validator',
}

export const FormulaTypeValues = Object.values(FormulaType)

export type TypedFormula = { name: string } & (
  | {
      type: FormulaType.Account
      formula: AccountFormula
    }
  | {
      type: FormulaType.Contract
      formula: ContractFormula
    }
  | {
      type: FormulaType.Generic
      formula: GenericFormula
    }
  | {
      type: FormulaType.Validator
      formula: ValidatorFormula
    }
)

export type CacheMap<T> = Record<string, T[] | null | undefined>
export type CacheMapSingle<T> = Record<string, T | null | undefined>

export type Cache = {
  events: CacheMap<DependableEventModel>
  contracts: CacheMapSingle<Contract>
}

export type ComputeOptions = {
  chainId: string
  targetAddress: string
  args: Record<string, any>
  block: Block
  cache?: Partial<Cache>
} & TypedFormula

export type ComputeRangeOptions = {
  chainId: string
  targetAddress: string
  args: Record<string, any>
  blockStart: Block
  blockEnd: Block
  blockStep?: bigint
  timeStep?: bigint
} & TypedFormula

export type NestedFormulaMap<F> = {
  [key: string]: F | NestedFormulaMap<F> | undefined
}
