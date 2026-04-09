import { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PendingWebhook, WebhookType } from '@/types'

const { mockedAxios } = vi.hoisted(() => ({
  mockedAxios: vi.fn(),
}))

vi.mock('axios', () => ({
  __esModule: true,
  default: mockedAxios,
}))

describe('WebhooksQueue', () => {
  let WebhooksQueue: typeof import('./webhooks').WebhooksQueue

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockedAxios.mockResolvedValue({
      status: 200,
      data: {},
      headers: {},
    } as any)
    ;({ WebhooksQueue } = await import('./webhooks'))
  })

  it('applies configured HTTP timeouts to outbound webhooks', async () => {
    const queue = new WebhooksQueue({
      config: {
        webhookTimeoutMs: 4321,
      } as any,
      sendWebhooks: true,
    })

    await queue.process({
      data: {
        eventType: 'Extraction',
        eventId: 1,
        endpoint: {
          type: WebhookType.Url,
          url: 'https://partner.example/deposits',
          method: 'POST',
        },
        value: {
          hello: 'world',
        },
      },
    } as Job<PendingWebhook>)

    expect(mockedAxios).toHaveBeenCalledWith(
      'https://partner.example/deposits',
      expect.objectContaining({
        method: 'POST',
        timeout: 4321,
        data: {
          hello: 'world',
        },
      })
    )
  })

  it('falls back to the default webhook timeout', async () => {
    const queue = new WebhooksQueue({
      config: {} as any,
      sendWebhooks: true,
    })

    await queue.process({
      data: {
        eventType: 'Extraction',
        eventId: 1,
        endpoint: {
          type: WebhookType.Url,
          url: 'https://partner.example/deposits',
          method: 'POST',
        },
        value: {},
      },
    } as Job<PendingWebhook>)

    expect(mockedAxios).toHaveBeenCalledWith(
      'https://partner.example/deposits',
      expect.objectContaining({
        timeout: 15000,
      })
    )
  })
})
