import { Job } from 'bullmq'
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Extraction } from '@/db'
import { extractorMakers } from '@/listener'
import * as search from '@/search'
import * as webhooks from '@/webhooks'

import { ExtractQueue, ExtractQueuePayload } from './extract'

describe('ExtractQueue', () => {
  let extractQueue: ExtractQueue
  let mockExtractor: any
  let mockJob: Job<ExtractQueuePayload>
  let logSpy: Mock

  beforeEach(async () => {
    vi.clearAllMocks()

    logSpy = vi.fn().mockImplementation(async () => 0)

    vi.spyOn(search, 'queueMeilisearchIndexUpdates').mockResolvedValue(1)
    vi.spyOn(webhooks, 'queueWebhooks').mockResolvedValue(1)

    // Mock extractor
    mockExtractor = {
      match: vi.fn(),
      extract: vi.fn().mockResolvedValue([
        await Extraction.build({
          address: 'juno1test123',
          name: 'dao-dao-core/info',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: { test: 'data' },
        }),
      ]),
    }

    // Mock extractor makers
    extractorMakers.dao = vi.fn()
    extractorMakers.testExtractor = vi.fn()
    vi.mocked(extractorMakers.dao).mockResolvedValue(mockExtractor)
    vi.mocked(extractorMakers.testExtractor).mockResolvedValue(mockExtractor)

    // Create extract queue
    extractQueue = new ExtractQueue({
      config: ConfigManager.load(),
      sendWebhooks: true,
    })

    await extractQueue.init()

    // Mock job
    mockJob = {
      data: {
        extractor: 'dao',
        data: {
          txHash: 'test-hash-123',
          height: '1000',
          data: {
            addresses: ['juno1test123contract456'],
          },
        },
      },
      log: logSpy as (message: string) => Promise<number>,
    } as Job<ExtractQueuePayload>
  })

  describe('init', () => {
    it('should initialize extractors', async () => {
      expect(vi.mocked(extractorMakers.dao)).toHaveBeenCalledWith({
        config: ConfigManager.load(),
        sendWebhooks: true,
        autoCosmWasmClient: expect.any(Object),
      })
    })

    it('should handle extractor initialization failure', async () => {
      const failingExtractorMaker = vi
        .fn()
        .mockRejectedValue(new Error('Extractor init failed'))

      const failingQueue = new ExtractQueue({
        config: ConfigManager.load(),
        sendWebhooks: false,
      })

      // Add failing extractor maker
      extractorMakers.failingExtractor = failingExtractorMaker

      await expect(failingQueue.init()).rejects.toThrow()

      // Remove failing extractor maker
      delete extractorMakers.failingExtractor
    })
  })

  describe('process', () => {
    it('should process extraction job successfully', async () => {
      await extractQueue.process(mockJob)

      expect(mockExtractor.extract).toHaveBeenCalledWith({
        txHash: 'test-hash-123',
        height: '1000',
        data: {
          addresses: ['juno1test123contract456'],
        },
      })

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
            txHash: 'test-hash',
            height: '1000',
            data: {},
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
      mockExtractor.extract.mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return Promise.resolve([
          Extraction.build({
            address: 'juno1test123',
            name: 'dao-dao-core/info',
            blockHeight: '1000',
            blockTimeUnixMs: '1640995200000',
            txHash: 'test-hash',
            data: { test: 'data' },
          }),
        ])
      })

      await extractQueue.process(mockJob)

      expect(attempts).toBe(3) // Should have retried 3 times total
      expect(mockExtractor.extract).toHaveBeenCalledTimes(3)
    })

    it('should fail after maximum retries', async () => {
      mockExtractor.extract.mockRejectedValue(new Error('Persistent failure'))

      await expect(extractQueue.process(mockJob)).rejects.toThrow(
        'Persistent failure'
      )

      expect(mockExtractor.extract).toHaveBeenCalledTimes(3)
    })

    it('should handle empty extraction results', async () => {
      mockExtractor.extract.mockResolvedValue([])

      await extractQueue.process(mockJob)

      // Should complete without errors
      expect(mockExtractor.extract).toHaveBeenCalledOnce()
    })

    it('should handle non-array extraction results', async () => {
      mockExtractor.extract.mockResolvedValue(null)

      await extractQueue.process(mockJob)

      // Should complete without errors
      expect(mockExtractor.extract).toHaveBeenCalledOnce()
    })

    it('should timeout after 30 seconds', async () => {
      vi.useFakeTimers()

      mockExtractor.extract.mockImplementation(
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

      expect(mockExtractor.extract).toHaveBeenCalledOnce()
    })

    it('should handle webhook queueing failures gracefully', async () => {
      vi.mocked(webhooks.queueWebhooks).mockRejectedValue(
        new Error('Webhook failed')
      )

      // Should still complete the job even if webhook queueing fails
      await extractQueue.process(mockJob)

      expect(mockExtractor.extract).toHaveBeenCalledOnce()
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
      const secondExtractor = {
        match: vi.fn(),
        extract: vi.fn().mockResolvedValue([
          Extraction.build({
            address: 'juno1test456',
            name: 'test/data',
            blockHeight: '1001',
            blockTimeUnixMs: '1640995260000',
            txHash: 'test-hash-2',
            data: { test: 'data2' },
          }),
        ]),
      }

      vi.mocked(extractorMakers.testExtractor).mockResolvedValue(
        secondExtractor
      )

      const testQueue = new ExtractQueue({
        config: ConfigManager.load(),
        sendWebhooks: false,
      })
      await testQueue.init()

      const testJob = {
        data: {
          extractor: 'testExtractor',
          data: {
            txHash: 'test-hash-456',
            height: '1001',
            data: { test: 'payload' },
          },
        },
        log: logSpy as (message: string) => Promise<number>,
      } as Job<ExtractQueuePayload>

      await testQueue.process(testJob)

      expect(secondExtractor.extract).toHaveBeenCalledWith({
        txHash: 'test-hash-456',
        height: '1001',
        data: { test: 'payload' },
      })
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
