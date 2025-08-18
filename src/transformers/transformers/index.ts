import * as Sentry from '@sentry/node'

import { WasmCodeService } from '@/services/wasm-codes'
import { ProcessedTransformer, Transformer } from '@/types'

import common from './common'
import dao from './dao'
import delegation from './delegation'
import distribution from './distribution'
import external from './external'
import polytone from './polytone'
import prePropose from './prePropose'
import proposal from './proposal'
import staking from './staking'
import valence from './valence'
import voting from './voting'
import xion from './xion'

let processedTransformers: ProcessedTransformer[] | undefined
export const getProcessedTransformers = (): ProcessedTransformer[] => {
  if (!processedTransformers) {
    const _transformers: Transformer[] = [
      // Add transformers here.
      ...common,
      ...dao,
      ...delegation,
      ...distribution,
      ...external,
      ...polytone,
      ...prePropose,
      ...proposal,
      ...staking,
      ...valence,
      ...voting,
      ...xion,
    ]

    processedTransformers = _transformers.map(({ filter, ...webhook }) => ({
      ...webhook,
      filter: (event) => {
        let match = true

        // If codeIdsKeys is 'any', match all code IDs. Otherwise, match the
        // given code IDs. If no code IDs present, do not match. This ensures
        // that missing code IDs do not lead to transformers matching all, which
        // might happen if some contracts only exist on certain chains.
        if (filter.codeIdsKeys !== 'any') {
          const allCodeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
            ...(filter.codeIdsKeys ?? [])
          )

          if (allCodeIds.length) {
            match &&= allCodeIds.includes(event.codeId)
          } else {
            match = false
          }
        }

        if (match && filter.contractAddresses?.length) {
          match &&= filter.contractAddresses.includes(event.contractAddress)
        }

        if (match && filter.matches) {
          // Wrap in try/catch in case a transformer errors. Don't want to
          // prevent other events from transforming.
          try {
            match &&= filter.matches(event)
          } catch (error) {
            console.error(
              `Error matching transformer for event ${event.blockHeight}/${event.contractAddress}/${event.key}: ${error}`
            )
            Sentry.captureException(error, {
              tags: {
                type: 'failed-transformer-match',
              },
              extra: {
                event,
              },
            })

            // On error, do not match.
            match = false
          }
        }

        return match
      },
    }))
  }

  return processedTransformers
}
