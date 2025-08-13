import * as Sentry from '@sentry/node'
import { Op } from 'sequelize'

import { State, WasmStateEventTransformation } from '@/db'
import {
  ParsedWasmStateEvent,
  PendingTransformation,
  UnevaluatedEventTransformation,
} from '@/types'

import { getProcessedTransformers } from './transformers'

export const transformParsedStateEvents = async (
  events: ParsedWasmStateEvent[]
): Promise<WasmStateEventTransformation[]> => {
  if (events.length === 0) {
    return []
  }

  const chainId = (await State.getSingleton())?.chainId || 'unknown'
  const transformers = getProcessedTransformers()
  if (transformers.length === 0) {
    return []
  }

  // Collect all pending transformations before evaluating them. This is
  // because some transformations may depend on the value of previous
  // transformations, which may exist in this current set of uncommitted
  // transformations. Thus, we need to evaluate them sequentially.
  const unevaluatedTransformations: UnevaluatedEventTransformation[] =
    events.flatMap((event) => {
      const transformersForEvent = transformers.filter((transformer) =>
        transformer.filter(event)
      )

      return transformersForEvent
        .map((transformer) => {
          // Wrap in try/catch in case a transformer errors. Don't want to
          // prevent other events from transforming correctly.
          let name
          try {
            name =
              typeof transformer.name === 'string'
                ? transformer.name
                : transformer.name(event)
          } catch (error) {
            console.error(
              `Error getting transformation name for event ${event.blockHeight}/${event.contractAddress}/${event.key}`,
              error
            )
            Sentry.captureException(error, {
              tags: {
                type: 'failed-transform-get-name',
                chainId,
              },
              extra: {
                event,
              },
            })
            return undefined
          }

          // If name is empty string or undefined, can't transform.
          if (!name) {
            return undefined
          }

          return {
            event,
            transformer,
            pendingTransformation: {
              contractAddress: event.contractAddress,
              blockHeight: event.blockHeight,
              blockTimeUnixMs: event.blockTimeUnixMs,
              name,
              value: undefined,
            },
          }
        })
        .filter((t): t is UnevaluatedEventTransformation => !!t)
    })

  const evaluatedTransformations: PendingTransformation[] = []

  // Evaluate all pending transformations sequentially.
  for (const {
    event,
    transformer,
    pendingTransformation,
  } of unevaluatedTransformations) {
    // Wrap in try/catch in case a transformer errors. Don't want to prevent
    // other events from transforming correctly.
    try {
      pendingTransformation.value =
        event.delete && !transformer.manuallyTransformDeletes
          ? null
          : await transformer.getValue(event, async () => {
              // Find most recent transformation for this contract and name
              // before this block.

              // Check evaluated transformations in case the most recent
              // transformation is in the current group of events.
              const evaluatedTransformation = evaluatedTransformations
                .filter(
                  (transformation) =>
                    transformation.contractAddress ===
                      pendingTransformation.contractAddress &&
                    transformation.name === pendingTransformation.name
                )
                .slice(-1)[0]

              if (evaluatedTransformation) {
                return evaluatedTransformation.value
              }

              // Fallback to database.
              return (
                (
                  await WasmStateEventTransformation.findOne({
                    where: {
                      contractAddress: event.contractAddress,
                      name: pendingTransformation.name,
                      blockHeight: {
                        [Op.lt]: event.blockHeight,
                      },
                    },
                    order: [['blockHeight', 'DESC']],
                  })
                )?.value ?? null
              )
            })

      if (pendingTransformation.value === undefined) {
        // Skip saving this transformation if the value is undefined.
        continue
      }

      // Update the latest transformation for the same contract, name, and
      // block height if it exists. We want this newer transformation to be
      // able to access the previous value during its evaluation, in case the
      // transformation is iterating on values, such as a counter, but only
      // one transformation can exist for a contract, name, and block height
      // set.
      const latestTransformation = evaluatedTransformations
        .filter(
          (transformation) =>
            transformation.contractAddress ===
              pendingTransformation.contractAddress &&
            transformation.name === pendingTransformation.name &&
            transformation.blockHeight === pendingTransformation.blockHeight
        )
        .slice(-1)[0]

      if (latestTransformation) {
        latestTransformation.value = pendingTransformation.value
      } else {
        evaluatedTransformations.push(pendingTransformation)
      }
    } catch (error) {
      console.error(
        `Error transforming event ${event.blockHeight}/${event.contractAddress}/${event.key}: ${error}`
      )
      Sentry.captureException(error, {
        tags: {
          type: 'failed-transform-get-value',
          chainId,
        },
        extra: {
          event,
          pendingTransformation,
        },
      })
    }
  }

  if (evaluatedTransformations.length === 0) {
    return []
  }

  // Save all pending transformations.
  return await WasmStateEventTransformation.bulkCreate(
    evaluatedTransformations,
    {
      updateOnDuplicate: ['value'],
      conflictAttributes: ['contractAddress', 'name', 'blockHeight'],
    }
  )
}
