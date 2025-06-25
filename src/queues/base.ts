import * as Sentry from '@sentry/node'
import { Job, Queue, Worker } from 'bullmq'

import { State } from '@/db'
import { Config } from '@/types'

import { getBullWorker } from './connection'

/**
 * The options for creating a queue.
 */
export type QueueOptions = {
  config: Config
  sendWebhooks: boolean
}

export abstract class BaseQueue<Payload = any, Result = any> {
  // Hack to make queue name available on abstract class and instances. Classes
  // that implement this interface only need to define the static `queueName`
  // property, and the instances will be able to access it.
  static queueName: string
  public queueName: string

  static getQueue: () => Queue

  constructor(protected options: QueueOptions) {
    this.queueName = (this.constructor as typeof BaseQueue).queueName
  }

  init(): Promise<void> {
    return Promise.resolve()
  }

  getWorker(): Worker<Payload, Result> {
    const worker = getBullWorker(this.queueName, this.process.bind(this))

    worker.on('error', async (err) => {
      console.error('Worker errored', err)

      Sentry.captureException(err, {
        tags: {
          type: 'worker-error',
          chainId: (await State.getSingleton())?.chainId ?? 'unknown',
          queueName: this.queueName,
        },
      })
    })

    return worker
  }

  abstract process(job: Job<Payload, Result>, token?: string): Promise<Result>
}
