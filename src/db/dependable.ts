import { ComputationDependentKey, DependableEventModel } from '@/types'

import {
  BankBalance,
  BankStateEvent,
  FeegrantAllowance,
  GovProposal,
  GovProposalVote,
  StakingSlashEvent,
  WasmStateEvent,
  WasmStateEventTransformation,
  WasmTxEvent,
} from './models'

export const getDependableEventModels = (): typeof DependableEventModel[] => [
  WasmStateEvent,
  WasmStateEventTransformation,
  WasmTxEvent,
  StakingSlashEvent,
  BankBalance,
  BankStateEvent,
  FeegrantAllowance,
  GovProposal,
  GovProposalVote,
  // DistributionCommunityPoolStateEvent,
]

// Get the dependable event model for a given key based on its namespace.
export const getDependableEventModelForKey = (
  key: string
): typeof DependableEventModel | undefined => {
  const namespace = key.split(':')[0]
  return getDependableEventModels().find(
    (model) => model.dependentKeyNamespace === namespace
  )
}

export const dependentKeyMatches = (
  a: ComputationDependentKey,
  b: ComputationDependentKey
) => a.key === b.key && a.prefix === b.prefix
