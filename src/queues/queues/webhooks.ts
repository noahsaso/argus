import axios from 'axios'
import { Job, Queue } from 'bullmq'
import Pusher from 'pusher'

import { PendingWebhook, WebhookType } from '@/types'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export class WebhooksQueue extends BaseQueue<PendingWebhook> {
  static queueName = 'webhooks'
  static concurrency = 5

  static getQueue = () => getBullQueue<PendingWebhook>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (...params: Parameters<Queue<PendingWebhook>['add']>) =>
    (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<PendingWebhook>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  async process({
    data: { endpoint, value },
  }: Job<PendingWebhook>): Promise<void> {
    switch (endpoint.type) {
      case WebhookType.Url: {
        await axios(endpoint.url, {
          method: endpoint.method,
          // https://stackoverflow.com/a/74735197
          headers: {
            'Accept-Encoding': 'gzip,deflate,compress',
            ...endpoint.headers,
          },
          data: value,
        })

        break
      }

      case WebhookType.Soketi: {
        if (!this.options.config.soketi) {
          throw new Error('Soketi config not found')
        }

        const pusher = new Pusher(this.options.config.soketi)
        await pusher.trigger(endpoint.channel, endpoint.event, value)

        break
      }

      default:
        throw new Error('Unknown webhook type: ' + (endpoint as any).type)
    }
  }
}
