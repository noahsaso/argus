import { Extraction, WasmStateEvent } from '@/db'
import { dao as daoProposalMultipleDao } from '@/formulas/formulas/contract/proposal/daoProposalMultiple'
import { MultipleChoiceProposal } from '@/formulas/formulas/contract/proposal/daoProposalMultiple/types'
import { dao as daoProposalSingleDao } from '@/formulas/formulas/contract/proposal/daoProposalSingle'
import { SingleChoiceProposal } from '@/formulas/formulas/contract/proposal/daoProposalSingle/types'
import { ContractEnv } from '@/types'
import { dbKeyToKeys } from '@/utils'

const CODE_IDS_KEY_SINGLE = 'dao-proposal-single'
const CODE_IDS_KEY_MULTIPLE = 'dao-proposal-multiple'

export const getDaoAddressForProposalModule = async (
  env: ContractEnv
): Promise<string | undefined> => {
  let daoAddress: string | undefined

  // dao-proposal-single
  if (
    await env.contractMatchesCodeIdKeys(
      env.contractAddress,
      CODE_IDS_KEY_SINGLE
    )
  ) {
    daoAddress = await daoProposalSingleDao.compute(env)
  }
  // dao-proposal-multiple
  else if (
    await env.contractMatchesCodeIdKeys(
      env.contractAddress,
      CODE_IDS_KEY_MULTIPLE
    )
  ) {
    daoAddress = await daoProposalMultipleDao.compute(env)
  }

  return daoAddress
}

/**
 * Get proposal ID and proposal from WasmStateEvent or Extraction models.
 */
export const getProposalFromModel = (
  proposalModulePrefix: string,
  event: WasmStateEvent | Extraction
) => {
  const proposalNum =
    event instanceof WasmStateEvent
      ? // "proposals"|"proposals_v2", proposalNum
        dbKeyToKeys(event.key, [false, true])[1]
      : Number(event.name.split(':')[1])
  const proposalId = `${proposalModulePrefix}${proposalNum}`
  const proposal: SingleChoiceProposal | MultipleChoiceProposal =
    event instanceof WasmStateEvent ? event.valueJson : event.data
  return { proposalId, proposal }
}
