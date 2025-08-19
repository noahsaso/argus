import { ProposalStatus } from '@dao-dao/types/protobuf/codegen/cosmos/gov/v1/gov'

import { GovProposal } from '@/db'
import { WebhookMaker, WebhookType } from '@/types'
import { decodeGovProposal } from '@/utils'

// Fire webhook when a gov proposal is created.
export const makeInboxGovProposalCreated: WebhookMaker<GovProposal> = (
  config,
  state
) => ({
  filter: {
    EventType: GovProposal,
  },
  endpoint: {
    type: WebhookType.Url,
    url: 'https://notifier.daodao.zone/notify',
    method: 'POST',
    headers: {
      'x-api-key': config.notifierSecret,
    },
  },
  getValue: async (event, getLastEvent) => {
    // Only fire the webhook if the last event does not exist (proposal launched
    // right into voting period) or was not open for voting (proposal started in
    // the deposit period).
    const lastEvent = await getLastEvent()
    const lastDecoded = lastEvent && decodeGovProposal(lastEvent.data)
    if (
      lastEvent &&
      // If could not decode and check that last event was voting, ignore to
      // avoid spamming when something breaks.
      (!lastDecoded ||
        // If last event was open for voting, ignore because already sent.
        lastDecoded.status === ProposalStatus.PROPOSAL_STATUS_VOTING_PERIOD)
    ) {
      return
    }

    const { proposal, title, status } = decodeGovProposal(event.data)
    if (status !== ProposalStatus.PROPOSAL_STATUS_VOTING_PERIOD) {
      return
    }

    return {
      chainId: state.chainId,
      type: 'proposal_created',
      data: {
        chainId: state.chainId,
        dao: 'GOV',
        daoName: state.chainId,
        imageUrl: 'GOV_PLACEHOLDER',
        proposalId: event.proposalId,
        proposalTitle: proposal ? title : event.proposalId,
        fromApprover: false,
      },
    }
  },
})

// Fire webhook when a gov proposal is passed (or passed + execution failed).
export const makeInboxGovProposalPassed: WebhookMaker<GovProposal> = (
  config,
  state
) => ({
  filter: {
    EventType: GovProposal,
  },
  endpoint: {
    type: WebhookType.Url,
    url: 'https://notifier.daodao.zone/notify',
    method: 'POST',
    headers: {
      'x-api-key': config.notifierSecret,
    },
  },
  getValue: async (event, getLastEvent) => {
    // Only fire the webhook if the last event was not passed.
    const lastEvent = await getLastEvent()
    const lastDecoded = lastEvent && decodeGovProposal(lastEvent.data)
    if (
      lastEvent &&
      // If could not decode and check that last event was passed, ignore to
      // avoid spamming when something breaks.
      (!lastDecoded ||
        // If last event was passed (or passed + execution failed), ignore
        // because already sent.
        lastDecoded.status === ProposalStatus.PROPOSAL_STATUS_PASSED ||
        lastDecoded.status === ProposalStatus.PROPOSAL_STATUS_FAILED)
    ) {
      return
    }

    const { proposal, title, status } = decodeGovProposal(event.data)
    if (
      status !== ProposalStatus.PROPOSAL_STATUS_PASSED &&
      status !== ProposalStatus.PROPOSAL_STATUS_FAILED
    ) {
      return
    }

    return {
      chainId: state.chainId,
      type: 'proposal_executed',
      data: {
        chainId: state.chainId,
        dao: 'GOV',
        daoName: state.chainId,
        imageUrl: 'GOV_PLACEHOLDER',
        proposalId: event.proposalId,
        proposalTitle: proposal ? title : event.proposalId,
        fromApprover: false,
        failed: status === ProposalStatus.PROPOSAL_STATUS_FAILED,
      },
    }
  },
})

// Fire webhook when a gov proposal is rejected.
export const makeInboxGovProposalRejected: WebhookMaker<GovProposal> = (
  config,
  state
) => ({
  filter: {
    EventType: GovProposal,
  },
  endpoint: {
    type: WebhookType.Url,
    url: 'https://notifier.daodao.zone/notify',
    method: 'POST',
    headers: {
      'x-api-key': config.notifierSecret,
    },
  },
  getValue: async (event, getLastEvent) => {
    // Only fire the webhook if the last event was not rejected.
    const lastEvent = await getLastEvent()
    const lastDecoded = lastEvent && decodeGovProposal(lastEvent.data)
    if (
      lastEvent &&
      // If could not decode and verify that last event was rejected, ignore to
      // avoid spamming when something breaks.
      (!lastDecoded ||
        // If last event was rejected, ignore because already sent.
        lastDecoded.status === ProposalStatus.PROPOSAL_STATUS_REJECTED)
    ) {
      return
    }

    const { proposal, title, status } = decodeGovProposal(event.data)
    if (status !== ProposalStatus.PROPOSAL_STATUS_REJECTED) {
      return
    }

    return {
      chainId: state.chainId,
      type: 'proposal_closed',
      data: {
        chainId: state.chainId,
        dao: 'GOV',
        daoName: state.chainId,
        imageUrl: 'GOV_PLACEHOLDER',
        proposalId: event.proposalId,
        proposalTitle: proposal ? title : event.proposalId,
        fromApprover: false,
      },
    }
  },
})
