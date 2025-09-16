import { Extraction, WasmStateEvent } from '@/db'
import {
  activeProposalModules,
  config as daoCoreConfig,
} from '@/formulas/formulas/contract/daoCore/base'
import { StatusEnum } from '@/formulas/formulas/contract/proposal/types'
import { WebhookMaker, WebhookType } from '@/types'
import { dbKeyForKeys } from '@/utils'

import { getDaoAddressForProposalModule, getProposalFromModel } from '../utils'

const CODE_IDS_KEYS = ['dao-proposal-single', 'dao-proposal-multiple']

const KEY_PREFIX_PROPOSALS = dbKeyForKeys('proposals', '')
const KEY_PREFIX_PROPOSALS_V2 = dbKeyForKeys('proposals_v2', '')

// Fire webhook when a proposal is created.
export const makeProposalCreated: WebhookMaker<WasmStateEvent | Extraction> = (
  config,
  state
) => ({
  filter: {
    EventType: [WasmStateEvent, Extraction],
    codeIdsKeys: CODE_IDS_KEYS,
    matches: (event) =>
      (event instanceof WasmStateEvent &&
        // Starts with proposals or proposals_v2.
        (event.key.startsWith(KEY_PREFIX_PROPOSALS) ||
          event.key.startsWith(KEY_PREFIX_PROPOSALS_V2)) &&
        event.valueJson.status === StatusEnum.Open) ||
      (event instanceof Extraction &&
        event.name.startsWith('proposal:') &&
        event.data.status === StatusEnum.Open),
  },
  endpoint: async (event, env) => {
    const daoAddress = await getDaoAddressForProposalModule({
      ...env,
      contractAddress: event.contractAddress,
    })
    if (!daoAddress) {
      return
    }

    return {
      type: WebhookType.Url,
      url: `https://telegram-notifier.dao-dao.workers.dev/${state.chainId}/${daoAddress}/notify`,
      method: 'POST',
    }
  },
  getValue: async (event, getLastEvent, env) => {
    // Only fire the webhook the first time this exists.
    if ((await getLastEvent()) !== null) {
      return
    }

    // Get DAO config and proposal modules for this DAO so we can retrieve the
    // DAO's name and the prefix for this proposal module.
    const daoAddress = await getDaoAddressForProposalModule({
      ...env,
      contractAddress: event.contractAddress,
    })
    if (!daoAddress) {
      return
    }

    const daoConfig = await daoCoreConfig.compute({
      ...env,
      contractAddress: daoAddress,
    })
    const proposalModules = await activeProposalModules.compute({
      ...env,
      contractAddress: daoAddress,
    })
    const proposalModule = proposalModules?.find(
      (proposalModule) => proposalModule.address === event.contractAddress
    )

    if (!daoConfig || !proposalModule) {
      return
    }

    const daoUrl = config.daoDaoBase + `/dao/${daoAddress}`
    const { proposalId, proposal } = getProposalFromModel(
      proposalModule.prefix,
      event
    )

    return {
      type: 'proposal_created',
      apiKey: config.telegramNotifierApiKey,
      daoName: daoConfig.name,
      proposalTitle: proposal.title,
      proposalDescription: proposal.description,
      proposalId,
      daoUrl,
      url: daoUrl + `/proposals/${proposalId}`,
    }
  },
})

// Fire webhook when a proposal is executed or closed.
export const makeProposalExecutedOrClosed: WebhookMaker<
  WasmStateEvent | Extraction
> = (config, state) => ({
  filter: {
    EventType: [WasmStateEvent, Extraction],
    codeIdsKeys: CODE_IDS_KEYS,
    matches: (event) =>
      (event instanceof WasmStateEvent &&
        // Starts with proposals or proposals_v2.
        (event.key.startsWith(KEY_PREFIX_PROPOSALS) ||
          event.key.startsWith(KEY_PREFIX_PROPOSALS_V2)) &&
        (event.valueJson.status === StatusEnum.Executed ||
          event.valueJson.status === StatusEnum.ExecutionFailed ||
          event.valueJson.status === StatusEnum.Closed)) ||
      (event instanceof Extraction &&
        event.name.startsWith('proposal:') &&
        (event.data.status === StatusEnum.Executed ||
          event.data.status === StatusEnum.ExecutionFailed ||
          event.data.status === StatusEnum.Closed)),
  },
  endpoint: async (event, env) => {
    const daoAddress = await getDaoAddressForProposalModule({
      ...env,
      contractAddress: event.contractAddress,
    })
    if (!daoAddress) {
      return
    }

    return {
      type: WebhookType.Url,
      url: `https://telegram-notifier.dao-dao.workers.dev/${state.chainId}/${daoAddress}/notify`,
      method: 'POST',
    }
  },
  getValue: async (event, getLastEvent, env) => {
    // Only fire the webhook if the last event was not executed.
    const lastEventData = await getLastEvent().then(
      (lastEvent) =>
        lastEvent &&
        (lastEvent instanceof WasmStateEvent
          ? lastEvent.valueJson
          : lastEvent.data)
    )
    if (
      lastEventData &&
      (lastEventData.status === StatusEnum.Executed ||
        lastEventData.status === StatusEnum.ExecutionFailed ||
        lastEventData.status === StatusEnum.Closed)
    ) {
      return
    }

    // Get DAO config and proposal modules for this DAO so we can retrieve the
    // DAO's name and the prefix for this proposal module.
    const daoAddress = await getDaoAddressForProposalModule({
      ...env,
      contractAddress: event.contractAddress,
    })
    if (!daoAddress) {
      return
    }

    const daoConfig = await daoCoreConfig.compute({
      ...env,
      contractAddress: daoAddress,
    })
    const proposalModules = await activeProposalModules.compute({
      ...env,
      contractAddress: daoAddress,
    })
    const proposalModule = proposalModules?.find(
      (proposalModule) => proposalModule.address === event.contractAddress
    )

    if (!daoConfig || !proposalModule) {
      return
    }

    const { proposalId, proposal } = getProposalFromModel(
      proposalModule.prefix,
      event
    )

    // Include winning option if executed and multiple choice proposal.
    let winningOption: string | undefined
    if (
      proposal.status !== StatusEnum.Closed &&
      'choices' in proposal &&
      'votes' in proposal
    ) {
      // Pick choice with largest voting weight.
      const winningChoice = proposal.choices.reduce((curr, choice) => {
        const currentWeight = BigInt(proposal.votes.vote_weights[curr.index])
        const weight = BigInt(proposal.votes.vote_weights[choice.index])
        return currentWeight > weight ? curr : choice
      })
      winningOption = winningChoice?.title
    }

    const daoUrl = config.daoDaoBase + `/dao/${daoAddress}`

    const type =
      proposal.status === StatusEnum.Executed
        ? 'proposal_executed'
        : proposal.status === StatusEnum.ExecutionFailed
        ? 'proposal_execution_failed'
        : proposal.status === StatusEnum.Closed
        ? 'proposal_closed'
        : ''
    if (!type) {
      return
    }

    return {
      type,
      apiKey: config.telegramNotifierApiKey,
      daoName: daoConfig.name,
      proposalTitle: proposal.title,
      proposalDescription: proposal.description,
      proposalId,
      daoUrl,
      url: daoUrl + `/proposals/${proposalId}`,
      winningOption,
    }
  },
})
