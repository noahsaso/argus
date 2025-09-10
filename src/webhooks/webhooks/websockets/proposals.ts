import { GovProposal, State, WasmStateEvent } from '@/db'
import { activeProposalModules } from '@/formulas/formulas/contract/daoCore/base'
import { Webhook, WebhookMaker, WebhookType } from '@/types'
import { dbKeyForKeys, dbKeyToKeys, decodeGovProposal } from '@/utils'

import { getDaoAddressForProposalModule } from '../../utils'

const CODE_IDS_KEY_SINGLE = 'dao-proposal-single'
const CODE_IDS_KEY_MULTIPLE = 'dao-proposal-multiple'

const KEY_PREFIX_BALLOTS = dbKeyForKeys('ballots', '')
const KEY_PREFIX_PROPOSALS = dbKeyForKeys('proposals', '')
const KEY_PREFIX_PROPOSALS_V2 = dbKeyForKeys('proposals_v2', '')

const makeDaoWebSocketEndpoint =
  ({ chainId }: State): Webhook<WasmStateEvent>['endpoint'] =>
  async (event, env) => {
    // Get DAO address.
    const daoAddress = await getDaoAddressForProposalModule({
      ...env,
      contractAddress: event.contractAddress,
    })
    if (!daoAddress) {
      return
    }

    return {
      type: WebhookType.Soketi,
      channel: `${chainId}_${daoAddress}`,
      event: 'broadcast',
    }
  }

// Broadcast to WebSockets when a vote is cast.
export const makeBroadcastVoteCast: WebhookMaker<WasmStateEvent> = (
  config,
  state
) =>
  config.soketi && {
    filter: {
      EventType: WasmStateEvent,
      codeIdsKeys: [CODE_IDS_KEY_SINGLE, CODE_IDS_KEY_MULTIPLE],
      matches: (event) => event.key.startsWith(KEY_PREFIX_BALLOTS),
    },
    endpoint: makeDaoWebSocketEndpoint(state),
    getValue: async (event, _, env) => {
      // "ballots", proposalNum, voter
      const [, proposalNum, voter] = dbKeyToKeys(event.key, [
        false,
        true,
        false,
      ])

      // Get DAO address.
      const daoAddress = await getDaoAddressForProposalModule({
        ...env,
        contractAddress: event.contractAddress,
      })
      if (!daoAddress) {
        return
      }

      // Get proposal module prefix from DAO's list.
      const proposalModules = await activeProposalModules.compute({
        ...env,
        contractAddress: daoAddress,
      })
      const proposalModule = proposalModules?.find(
        (proposalModule) => proposalModule.address === event.contractAddress
      )
      if (!proposalModule) {
        return
      }

      const proposalId = `${proposalModule.prefix}${proposalNum}`

      return {
        type: 'vote',
        data: {
          proposalId,
          voter,
        },
      }
    },
  }

// Broadcast to WebSockets when a proposal status changes, including creation.
export const makeDaoProposalStatusChanged: WebhookMaker<WasmStateEvent> = (
  config,
  state
) =>
  config.soketi && {
    filter: {
      EventType: WasmStateEvent,
      codeIdsKeys: [CODE_IDS_KEY_SINGLE, CODE_IDS_KEY_MULTIPLE],
      matches: (event) =>
        event.key.startsWith(KEY_PREFIX_PROPOSALS) ||
        event.key.startsWith(KEY_PREFIX_PROPOSALS_V2),
    },
    endpoint: makeDaoWebSocketEndpoint(state),
    getValue: async (event, getLastEvent, env) => {
      // Only fire the webhook when the status changes.
      const lastEvent = await getLastEvent()
      if (lastEvent && lastEvent.valueJson.status === event.valueJson.status) {
        return
      }

      // Get DAO address.
      const daoAddress = await getDaoAddressForProposalModule({
        ...env,
        contractAddress: event.contractAddress,
      })
      if (!daoAddress) {
        return
      }

      // Get proposal module prefix from DAO's list.
      const proposalModules = await activeProposalModules.compute({
        ...env,
        contractAddress: daoAddress,
      })
      const proposalModule = proposalModules?.find(
        (proposalModule) => proposalModule.address === event.contractAddress
      )
      if (!proposalModule) {
        return
      }

      // "proposals"|"proposals_v2", proposalNum
      const [, proposalNum] = dbKeyToKeys(event.key, [false, true])
      const proposalId = `${proposalModule.prefix}${proposalNum}`

      return {
        type: 'proposal',
        data: {
          proposalId,
          status: event.valueJson.status,
        },
      }
    },
  }

// Broadcast to WebSockets when a gov proposal status changes, including
// creation.
export const makeGovProposalStatusChanged: WebhookMaker<GovProposal> = (
  config,
  state
) =>
  config.soketi && {
    filter: {
      EventType: GovProposal,
    },
    endpoint: {
      type: WebhookType.Soketi,
      channel: `${state.chainId}_GOV`,
      event: 'broadcast',
    },
    getValue: async (event, getLastEvent) => {
      // Only fire the webhook when the status changes.
      const lastEvent = await getLastEvent()
      const lastStatus = lastEvent && decodeGovProposal(lastEvent.data)?.status
      const status = decodeGovProposal(event.data)?.status
      if (lastStatus && lastStatus === status) {
        return
      }

      return {
        type: 'proposal',
        data: {
          proposalId: event.proposalId,
          status,
        },
      }
    },
  }
