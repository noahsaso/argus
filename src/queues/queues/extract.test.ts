import { Job } from 'bullmq'
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Extraction } from '@/db'
import * as listenerModule from '@/listener'
import * as search from '@/search'
import { AutoCosmWasmClient } from '@/utils'
import * as utils from '@/utils'
import * as webhooks from '@/webhooks'

import { ExtractQueue, ExtractQueuePayload } from './extract'

describe('ExtractQueue', () => {
  let extractQueue: ExtractQueue
  let mockExtractor: ReturnType<typeof vi.fn>
  let mockExtract: ReturnType<typeof vi.fn>
  let mockJob: Job<ExtractQueuePayload>
  let logSpy: Mock
  let mockGetExtractorMap = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()

    logSpy = vi.fn().mockImplementation(async () => 0)

    vi.spyOn(search, 'queueMeilisearchIndexUpdates').mockResolvedValue(1)
    vi.spyOn(webhooks, 'queueWebhooks').mockResolvedValue(1)

    // Mock extractor

    mockExtract = vi.fn().mockResolvedValue([
      Extraction.build({
        address: 'juno1test123',
        name: 'info',
        blockHeight: '1000',
        blockTimeUnixMs: '1640995200000',
        txHash: 'test-hash',
        data: { test: 'data' },
      }),
    ])

    mockExtractor = vi.fn(() => ({
      extract: mockExtract,
    }))

    // Mock extractors
    vi.spyOn(listenerModule, 'getExtractorMap').mockImplementation(
      mockGetExtractorMap
    )
    mockGetExtractorMap.mockImplementation(() => ({
      test: mockExtractor,
    }))

    vi.spyOn(AutoCosmWasmClient.prototype, 'update').mockImplementation(vi.fn())
    vi.spyOn(utils, 'getContractInfo').mockImplementation(vi.fn())

    // Create extract queue
    extractQueue = new ExtractQueue({
      config: ConfigManager.load(),
      sendWebhooks: true,
    })

    await extractQueue.init()

    // Mock job
    mockJob = {
      data: {
        extractor: 'test',
        data: {
          source: 'test',
          handler: 'test',
          data: {
            test: 'data',
          },
        },
        env: {
          txHash: 'test-hash-123',
          block: {
            height: '1000',
            timeUnixMs: '1640995200000',
            timestamp: '2022-01-01T00:00:00Z',
          },
        },
      },
      log: logSpy as (message: string) => Promise<number>,
    } as Job<ExtractQueuePayload>
  })

  describe('process', () => {
    it('should process extraction job successfully', async () => {
      await extractQueue.process(mockJob)

      expect(mockExtract).toHaveBeenCalledWith([
        {
          source: 'test',
          handler: 'test',
          data: {
            test: 'data',
          },
        },
      ])

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Queued 1 search index update(s)')
      )
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Queued 1 webhook(s)')
      )
    })

    it('should handle extractor not found error', async () => {
      const invalidJob = {
        data: {
          extractor: 'nonexistent',
          data: {
            source: 'test',
            handler: 'test',
            data: {
              test: 'data',
            },
          },
          env: {
            txHash: 'test-hash',
            block: {
              height: '1000',
              timeUnixMs: '1640995200000',
              timestamp: '2022-01-01T00:00:00Z',
            },
          },
        },
        log: async (_) => 0,
      } as Job<ExtractQueuePayload>

      await expect(extractQueue.process(invalidJob)).rejects.toThrow(
        'Extractor nonexistent not found.'
      )
    })

    it('should retry extraction on failure', async () => {
      let attempts = 0
      mockExtract.mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return Promise.resolve([
          Extraction.build({
            address: 'juno1test123',
            name: 'info',
            blockHeight: '1000',
            blockTimeUnixMs: '1640995200000',
            txHash: 'test-hash',
            data: { test: 'data' },
          }),
        ])
      })

      await extractQueue.process(mockJob)

      expect(attempts).toBe(3) // Should have retried 3 times total
      expect(mockExtract).toHaveBeenCalledTimes(3)
    })

    it('should fail after maximum retries', async () => {
      mockExtract.mockRejectedValue(new Error('Persistent failure'))

      await expect(extractQueue.process(mockJob)).rejects.toThrow(
        'Persistent failure'
      )

      expect(mockExtract).toHaveBeenCalledTimes(3)
    })

    it('should handle empty extraction results', async () => {
      mockExtract.mockResolvedValue([])

      await extractQueue.process(mockJob)

      // Should complete without errors
      expect(mockExtract).toHaveBeenCalledOnce()
    })

    it('should timeout after 30 seconds', async () => {
      vi.useFakeTimers()

      mockExtract.mockImplementation(
        () =>
          new Promise(() => {
            // Never resolve to simulate hanging
          })
      )

      const processPromise = extractQueue.process(mockJob)

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(30000)

      await expect(processPromise).rejects.toThrow(
        'Extract timed out after 30 seconds.'
      )

      vi.useRealTimers()
    })

    it('should not queue webhooks when sendWebhooks is false', async () => {
      const queueWithoutWebhooks = new ExtractQueue({
        config: ConfigManager.load(),
        sendWebhooks: false,
      })
      await queueWithoutWebhooks.init()

      vi.mocked(webhooks.queueWebhooks).mockClear()

      await queueWithoutWebhooks.process(mockJob)

      expect(webhooks.queueWebhooks).not.toHaveBeenCalled()
    })

    it('should handle meilisearch indexing failures gracefully', async () => {
      vi.mocked(search.queueMeilisearchIndexUpdates).mockRejectedValue(
        new Error('Meilisearch failed')
      )

      // Should still complete the job even if meilisearch fails
      await extractQueue.process(mockJob)

      expect(mockExtract).toHaveBeenCalledOnce()
    })

    it('should handle webhook queueing failures gracefully', async () => {
      vi.mocked(webhooks.queueWebhooks).mockRejectedValue(
        new Error('Webhook failed')
      )

      // Should still complete the job even if webhook queueing fails
      await extractQueue.process(mockJob)

      expect(mockExtract).toHaveBeenCalledOnce()
    })

    it('should log search index updates when queued', async () => {
      vi.mocked(search.queueMeilisearchIndexUpdates).mockResolvedValue(5) // Multiple updates

      await extractQueue.process(mockJob)

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Queued 5 search index update(s)')
      )
    })

    it('should log webhooks when queued', async () => {
      vi.mocked(webhooks.queueWebhooks).mockResolvedValue(3) // Multiple webhooks

      await extractQueue.process(mockJob)

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Queued 3 webhook(s)')
      )
    })

    it('should not log when no updates are queued', async () => {
      vi.mocked(search.queueMeilisearchIndexUpdates).mockResolvedValue(0)
      vi.mocked(webhooks.queueWebhooks).mockResolvedValue(0)

      await extractQueue.process(mockJob)

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Queued'))
    })

    it('should process multiple extractors', async () => {
      const secondExtractor = vi.fn(() => ({
        extract: mockExtract,
      }))

      mockGetExtractorMap.mockImplementation(() => ({
        test: mockExtractor,
        testExtractor: secondExtractor,
      }))

      const testQueue = new ExtractQueue({
        config: ConfigManager.load(),
        sendWebhooks: false,
      })
      await testQueue.init()

      const testJob = {
        data: {
          extractor: 'testExtractor',
          data: {
            source: 'test',
            handler: 'test',
            data: {
              test: 'payload',
            },
          },
          env: {
            txHash: 'test-hash-456',
            block: {
              height: '1001',
              timeUnixMs: '1640995260000',
              timestamp: '2022-01-01T00:00:00Z',
            },
          },
        },
        log: logSpy as (message: string) => Promise<number>,
      } as Job<ExtractQueuePayload>

      await testQueue.process(testJob)

      expect(secondExtractor).toHaveBeenCalledWith({
        config: expect.any(Object),
        sendWebhooks: false,
        autoCosmWasmClient: expect.any(Object),
        txHash: 'test-hash-456',
        block: {
          height: '1001',
          timeUnixMs: '1640995260000',
          timestamp: '2022-01-01T00:00:00Z',
        },
      })

      expect(mockExtract).toHaveBeenCalledWith([
        {
          source: 'test',
          handler: 'test',
          data: {
            test: 'payload',
          },
        },
      ])
    })
  })

  describe('static methods', () => {
    it('should have correct queue name', () => {
      expect(ExtractQueue.queueName).toBe('extract')
    })

    it('should provide queue access methods', async () => {
      expect(ExtractQueue.getQueue).toBeDefined()
      expect(ExtractQueue.getQueueEvents).toBeDefined()
      expect(ExtractQueue.add).toBeDefined()
      expect(ExtractQueue.addBulk).toBeDefined()
      expect(ExtractQueue.close).toBeDefined()
    })
  })
})
