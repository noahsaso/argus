import { toUtf8 } from '@cosmjs/encoding'
import { Event } from '@cosmjs/stargate'
import { DecodedStargateMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { MockInstance, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Block, Contract, Extraction } from '@/db'
import { AutoCosmWasmClient } from '@/utils'

import { ContractsExtractorData, contract } from './contract'

describe('Contracts Extractor', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let extractor: Awaited<ReturnType<typeof contract>>
  let queryContractRawMock: MockInstance

  beforeEach(async () => {
    queryContractRawMock = vi.fn()

    // Create mock AutoCosmWasmClient
    mockAutoCosmWasmClient = {
      update: vi.fn(),
      client: {
        getContract: vi.fn(),
        getBlock: vi.fn(),
        getHeight: vi.fn(),
        forceGetQueryClient: vi.fn().mockReturnValue({
          wasm: {
            queryContractRaw: queryContractRawMock,
          },
        }),
      },
    } as any

    // Set up the extractor
    extractor = await contract({
      config: ConfigManager.load(),
      sendWebhooks: false,
      autoCosmWasmClient: mockAutoCosmWasmClient,
    })
  })

  describe('match function', () => {
    const createMockTx = (): Tx => ({
      body: {
        messages: [],
        memo: '',
        timeoutHeight: 0n,
        extensionOptions: [],
        nonCriticalExtensionOptions: [],
      },
      authInfo: {
        signerInfos: [],
        fee: {
          amount: [],
          gasLimit: 0n,
          payer: '',
          granter: '',
        },
      },
      signatures: [],
    })

    const createMockMessages = (): DecodedStargateMsg['stargate'][] => []

    it('should match instantiation events', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '1234' },
            { key: '_contract_address', value: 'juno123contract456' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'test-hash',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toEqual({
        addresses: ['juno123contract456'],
      })
    })

    it('should match multiple instantiations', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '1234' },
            { key: '_contract_address', value: 'juno123contract456' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '567' },
            { key: '_contract_address', value: 'juno789contract012' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'test-hash',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toEqual({
        addresses: ['juno123contract456', 'juno789contract012'],
      })
    })

    it('should return undefined when no matching events', () => {
      const events: Event[] = [
        {
          type: 'other',
          attributes: [
            { key: 'action', value: 'some_other_action' },
            { key: '_contract_address', value: 'juno1other123contract456' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'test-hash',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toBeUndefined()
    })
  })

  describe('extract function', () => {
    const mockContractInfo = {
      contract: 'crates.io:some-contract',
      version: '2.3.4',
    }

    beforeEach(async () => {
      // Create a test block in the database
      await Block.createOne({
        height: 1000,
        timeUnixMs: 1640995200000,
      })

      // Mock the client methods
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockResolvedValue({
        address: 'juno123contract456',
        codeId: 4862,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test Contract',
        ibcPortId: 'juno1ibc123',
      })

      queryContractRawMock.mockResolvedValueOnce({
        data: toUtf8(JSON.stringify(mockContractInfo)),
      })
    })

    it('should extract contract information successfully', async () => {
      const data: ContractsExtractorData = {
        addresses: ['juno123contract456'],
      }

      const result = (await extractor.extract({
        txHash: 'test-hash-123',
        height: '1000',
        data,
      })) as Extraction[]

      expect(mockAutoCosmWasmClient.update).toHaveBeenCalled()
      expect(mockAutoCosmWasmClient.client!.getContract).toHaveBeenCalledWith(
        'juno123contract456'
      )
      expect(queryContractRawMock).toHaveBeenCalledWith(
        'juno123contract456',
        toUtf8('contract_info')
      )

      expect(result).toHaveLength(1)

      // Check info extraction
      const infoExtraction = result.find((e) => e.name === 'info')
      expect(infoExtraction).toBeDefined()
      expect(infoExtraction!.address).toBe('juno123contract456')
      expect(infoExtraction!.blockHeight).toBe('1000')
      expect(infoExtraction!.txHash).toBe('test-hash-123')
      expect(infoExtraction!.data).toEqual(mockContractInfo)
    })

    it('should handle multiple addresses', async () => {
      const data: ContractsExtractorData = {
        addresses: ['juno123contract456', 'juno789contract012'],
      }

      // Mock additional contract calls
      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
        .mockResolvedValueOnce({
          address: 'juno123contract456',
          codeId: 4862,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test Contract 1',
          ibcPortId: 'juno1ibc123',
        })
        .mockResolvedValueOnce({
          address: 'juno789contract012',
          codeId: 4862,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test Contract 2',
          ibcPortId: 'juno1ibc456',
        })

      // Mock query calls for both contracts
      queryContractRawMock
        .mockResolvedValueOnce({
          data: toUtf8(JSON.stringify(mockContractInfo)),
        })
        .mockResolvedValueOnce({
          data: toUtf8(JSON.stringify(mockContractInfo)),
        })

      const result = (await extractor.extract({
        txHash: 'test-hash-456',
        height: '1000',
        data,
      })) as Extraction[]

      expect(result).toHaveLength(2) // 1 extraction per contract

      const addresses = result.map((r) => r.address)
      expect(addresses).toContain('juno123contract456')
      expect(addresses).toContain('juno789contract012')
    })

    it('should handle contract query failures gracefully', async () => {
      const data: ContractsExtractorData = {
        addresses: ['juno123contract456', 'juno789contract012'],
      }

      // Mock one successful and one failing contract
      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
        .mockResolvedValueOnce({
          address: 'juno123contract456',
          codeId: 4862,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test Contract 1',
          ibcPortId: undefined,
        })
        .mockResolvedValueOnce({
          address: 'juno789contract012',
          codeId: 4862,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test Contract 2',
          ibcPortId: undefined,
        })

      // Mock successful queries for first contract, failed for second
      queryContractRawMock.mockImplementation((address: string) => {
        // First contract
        if (address === 'juno123contract456') {
          return {
            data: toUtf8(JSON.stringify(mockContractInfo)),
          }
        }
        // Second contract
        throw new Error('Query failed')
      })

      const result = (await extractor.extract({
        txHash: 'test-hash-789',
        height: '1000',
        data,
      })) as Extraction[]

      // Should only have extractions for the successful contract
      expect(result.map((r) => r.toJSON())).toEqual([
        {
          address: 'juno123contract456',
          name: 'info',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash-789',
          data: mockContractInfo,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should get block time from RPC when not in database', async () => {
      const data: ContractsExtractorData = {
        addresses: ['juno123contract456'],
      }

      // Mock getBlock to return block info
      vi.mocked(mockAutoCosmWasmClient.client!.getBlock).mockResolvedValue({
        header: {
          time: '2022-01-01T01:00:00Z', // Different from DB time
        },
      } as any)

      const result = (await extractor.extract({
        txHash: 'test-hash-rpc',
        height: '2000', // Height not in database
        data,
      })) as Extraction[]

      expect(mockAutoCosmWasmClient.client!.getBlock).toHaveBeenCalledWith(2000)
      expect(result).toHaveLength(1)
      expect(result[0].blockTimeUnixMs).toBe(
        Date.parse('2022-01-01T01:00:00Z').toString()
      )
    })

    it('should create contracts in database with correct information', async () => {
      const data: ContractsExtractorData = {
        addresses: ['juno123contract456'],
      }

      await extractor.extract({
        txHash: 'test-hash-contract',
        height: '1000',
        data,
      })

      // Check that contract was created in database
      const contract = await Contract.findByPk('juno123contract456')
      expect(contract).toBeDefined()
      expect(contract!.codeId).toBe(4862)
      expect(contract!.admin).toBe('juno1admin123')
      expect(contract!.creator).toBe('juno1creator123')
      expect(contract!.label).toBe('Test Contract')
      expect(contract!.instantiatedAtBlockHeight).toBe('1000')
      expect(contract!.instantiatedAtBlockTimeUnixMs).toBe('1640995200000')
    })

    it('should throw error when client is not connected', async () => {
      // Mock client as undefined
      const brokenAutoClient = {
        ...mockAutoCosmWasmClient,
        client: undefined,
      }

      const brokenExtractor = await contract({
        config: ConfigManager.load(),
        sendWebhooks: false,
        autoCosmWasmClient: brokenAutoClient as any,
      })

      const data: ContractsExtractorData = {
        addresses: ['juno123contract456'],
      }

      await expect(
        brokenExtractor.extract({
          txHash: 'test-hash-error',
          height: '1000',
          data,
        })
      ).rejects.toThrow('CosmWasm client not connected')
    })
  })
})
