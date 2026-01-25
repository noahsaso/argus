import * as Sentry from '@sentry/node'
import { Processor, Queue, QueueBaseOptions, QueueEvents, Worker } from 'bullmq'

import { getRedisConfig } from '@/config/redis'
import { State } from '@/db/models'

/**
 * Cache bull queues by name so we don't make duplicates and can close all at
 * once on exit.
 */
export const activeBullQueues: Partial<Record<string, Queue>> = {}

export const getBullQueue = <T extends unknown>(name: string): Queue<T> => {
  if (!activeBullQueues[name]) {
    activeBullQueues[name] = new Queue<T>(name, {
      ...getBullMqConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 300,
        },
      },
    })

    activeBullQueues[name]?.on('error', async (err) => {
      console.error('Queue error', err)

      Sentry.captureException(err, {
        tags: {
          type: 'queue-error',
          chainId: (await State.getSingleton())?.chainId,
        },
      })
    })
  }
  return activeBullQueues[name]!
}

export const getBullQueueEvents = (name: string): QueueEvents =>
  new QueueEvents(name, getBullMqConnection())

/**
 * Close all active bull queues.
 *
 * @returns `Promise` that resolves when all queues are closed.
 */
export const closeAllBullQueues = async () =>
  await Promise.all(
    Object.values(activeBullQueues).map((queue) => queue?.close())
  )

/**
 * Close specific bull queue.
 *
 * @returns `Promise` that resolves when queue is closed.
 */
export const closeBullQueue = async (name: string) =>
  activeBullQueues[name]?.close() ?? Promise.resolve()

export const getBullWorker = <T extends unknown>(
  name: string,
  processor: Processor<T>,
  concurrency: number = 1
) =>
  new Worker<T>(name, processor, {
    ...getBullMqConnection(),
    concurrency,
    removeOnComplete: {
      // Keep last 1,000 successful jobs.
      count: 1_000,
    },
    // Keep last 30 days of failed jobs.
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
    },
  })

const getBullMqConnection = (): QueueBaseOptions => {
  const config = getRedisConfig()
  if (!config) {
    throw new Error('Redis config not found')
  }

  // The BullMQ docs (https://docs.bullmq.io/guide/connections#queue) say: When
  // using ioredis connections, be careful not to use the "keyPrefix" option in
  // ioredis as this option is not compatible with BullMQ, which provides its
  // own key prefixing mechanism by using prefix option.
  const { keyPrefix: prefix, ...connection } = config

  return {
    connection,
    prefix,
  }
}
