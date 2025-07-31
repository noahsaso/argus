import { fromBase64, toBech32 } from '@cosmjs/encoding'
import retry from 'async-await-retry'
import { Sequelize } from 'sequelize'

import { Block, GovProposal, GovProposalVote, State } from '@/db'
import { Handler, HandlerMaker, ParsedGovStateEvent } from '@/types'

const STORE_NAME = 'gov'

export const gov: HandlerMaker<ParsedGovStateEvent> = async ({
  config: { bech32Prefix },
}) => {
  const match: Handler<ParsedGovStateEvent>['match'] = (trace) => {
    // ProposalsKeyPrefix = 0x00
    // proposla keys are formatted as:
    // ProposalsKeyPrefix || proposalIdBytes

    // VotesKeyPrefix = 0x20
    // vote keys are formatted as:
    // VotesKeyPrefix || proposalIdBytes || voterAddressBytes

    // Proposals should never be deleted, and votes get cleared when the
    // proposal closes. We can ignore all of these since we want to maintain
    // history.
    if (trace.operation === 'delete' || !trace.value) {
      return
    }

    const keyData = fromBase64(trace.key)
    switch (keyData[0]) {
      // proposals
      case 0x00: {
        if (keyData.length !== 9) {
          return
        }

        let proposalId
        try {
          proposalId = Buffer.from(keyData.slice(1))
            .readBigUInt64BE()
            .toString()
        } catch {
          // Ignore decoding errors.
          return
        }

        // Get code ID and block timestamp from chain.
        const blockHeight = BigInt(trace.metadata.blockHeight).toString()

        const blockTimeUnixMs = BigInt(trace.blockTimeUnixMs).toString()
        const blockTimestamp = new Date(trace.blockTimeUnixMs)

        return {
          id: [blockHeight, proposalId].join(':'),
          type: 'proposal',
          data: {
            proposalId,
            blockHeight,
            blockTimeUnixMs,
            blockTimestamp,
            data: trace.value,
          },
        }
      }
      // votes
      case 0x20: {
        let proposalId
        try {
          proposalId = Buffer.from(keyData.slice(1))
            .readBigUInt64BE()
            .toString()
        } catch {
          // Ignore decoding errors.
          return
        }

        // Get code ID and block timestamp from chain.
        const blockHeight = BigInt(trace.metadata.blockHeight).toString()

        const blockTimeUnixMs = BigInt(trace.blockTimeUnixMs).toString()
        const blockTimestamp = new Date(trace.blockTimeUnixMs)

        // Address is length-prefixed.
        const addressLength = keyData[9]
        if (keyData.length !== 10 + addressLength) {
          return
        }

        const voterAddress = toBech32(bech32Prefix, keyData.slice(10))

        return {
          id: [blockHeight, proposalId, voterAddress].join(':'),
          type: 'vote',
          data: {
            proposalId,
            voterAddress,
            blockHeight,
            blockTimeUnixMs,
            blockTimestamp,
            data: trace.value,
          },
        }
      }
    }
  }

  const process: Handler<ParsedGovStateEvent>['process'] = async (events) => {
    const exportEvents = async () => {
      // Save blocks from events.
      await Block.createMany(
        [...new Set(events.map((e) => e.data.blockHeight))].map((height) => ({
          height,
          timeUnixMs: events.find((e) => e.data.blockHeight === height)!.data
            .blockTimeUnixMs,
        }))
      )

      const proposals = events.flatMap((e) =>
        e.type === 'proposal' ? e.data : []
      )
      const votes = events.flatMap((e) => (e.type === 'vote' ? e.data : []))

      return (
        await Promise.all([
          ...(proposals.length > 0
            ? [
                GovProposal.bulkCreate(proposals, {
                  // Unique index ensures that we don't insert duplicate events.
                  // If we encounter a duplicate, we update the `data` field in
                  // case event processing for a block was batched separately.
                  updateOnDuplicate: ['data'],
                }),
              ]
            : []),
          ...(votes.length > 0
            ? [
                GovProposalVote.bulkCreate(votes, {
                  // Unique index ensures that we don't insert duplicate events.
                  // If we encounter a duplicate, we update the `data` field in
                  // case event processing for a block was batched separately.
                  updateOnDuplicate: ['data'],
                }),
              ]
            : []),
        ])
      ).flat()
    }

    // Retry 3 times with exponential backoff starting at 100ms delay.
    const exportedEvents = (await retry(exportEvents, [], {
      retriesMax: 3,
      exponential: true,
      interval: 100,
    })) as (GovProposal | GovProposalVote)[]

    // Store last block height exported, and update latest block
    // height/time if the last export is newer.
    const lastEvent = events.sort(
      (a, b) => Number(a.data.blockHeight) - Number(b.data.blockHeight)
    )[events.length - 1]
    const lastBlockHeightExported = lastEvent.data.blockHeight
    const lastBlockTimeUnixMsExported = lastEvent.data.blockTimeUnixMs
    await State.updateSingleton({
      lastGovBlockHeightExported: Sequelize.fn(
        'GREATEST',
        Sequelize.col('lastGovBlockHeightExported'),
        lastBlockHeightExported
      ),

      latestBlockHeight: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockHeight'),
        lastBlockHeightExported
      ),
      latestBlockTimeUnixMs: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockTimeUnixMs'),
        lastBlockTimeUnixMsExported
      ),
    })

    return exportedEvents
  }

  return {
    storeName: STORE_NAME,
    match,
    process,
  }
}
