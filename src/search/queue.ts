import * as Sentry from '@sentry/node'

import { State } from '@/db'
import { SearchQueue } from '@/queues/queues/search'
import { DependableEventModel } from '@/types'

import { PendingMeilisearchIndexUpdate } from '../types/search'
import { meilisearchIndexers } from './indexers'

/**
 * Queue index updates for a given event. Returns how many updates were queued.
 */
export const queueMeilisearchIndexUpdates = async (
  event: DependableEventModel
): Promise<number> => {
  const automaticIndexers = meilisearchIndexers.filter(
    ({ automatic = true }) => automatic
  )
  if (automaticIndexers.length === 0) {
    return 0
  }

  const state = await State.getSingleton()
  if (!state) {
    throw new Error('State not found.')
  }

  const pendingUpdates = (
    await Promise.all(
      automaticIndexers.map(async ({ id, matches }) => {
        try {
          return matches({
            event,
            state,
          })
        } catch (error) {
          console.error(error)
          Sentry.captureException(error, {
            tags: {
              type: 'failed-indexer-update-match',
              eventType: event.constructor.name,
            },
            extra: {
              index: id,
              event: event.toJSON(),
            },
          })
        }
      })
    )
  ).flatMap((update, index): PendingMeilisearchIndexUpdate | [] =>
    update
      ? {
          index: automaticIndexers[index].index,
          update,
        }
      : []
  )

  if (pendingUpdates.length) {
    await SearchQueue.addBulk(
      pendingUpdates.map((data) => ({
        name: data.update.id,
        data,
      }))
    )
  }

  return pendingUpdates.length
}
