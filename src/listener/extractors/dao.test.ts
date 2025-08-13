import { Event } from '@cosmjs/stargate'
import { DecodedStargateMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Block, Contract, Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { AutoCosmWasmClient } from '@/utils'

import { DaoExtractorData, dao } from './dao'

describe('DAO Extractor', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let extractor: Awaited<ReturnType<typeof dao>>

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    vi.spyOn(instance, 'findWasmCodeIdsByKeys').mockImplementation(
      (key: string) => {
        if (key === 'dao-dao-core') {
          return [4862, 163] // Mock code IDs for dao-dao-core
        }
        return []
      }
    )
  })

  beforeEach(async () => {
    // Create mock AutoCosmWasmClient
    mockAutoCosmWasmClient = {
      update: vi.fn(),
      client: {
        getContract: vi.fn(),
        queryContractSmart: vi.fn(),
        getBlock: vi.fn(),
        getHeight: vi.fn(),
      },
    } as any

    // Set up the extractor
    extractor = await dao({
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

    it('should match DAO instantiation events', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '4862' },
            { key: '_contract_address', value: 'juno1dao123contract456' },
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
        addresses: ['juno1dao123contract456'],
      })
    })

    it('should match multiple DAO instantiations', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '4862' },
            { key: '_contract_address', value: 'juno1dao123contract456' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '163' },
            { key: '_contract_address', value: 'juno1dao789contract012' },
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
        addresses: ['juno1dao123contract456', 'juno1dao789contract012'],
      })
    })

    it('should not match non-DAO code IDs', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '999' }, // Not a DAO code ID
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

    it('should match DAO config update execution', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute_update_config' },
            { key: 'name', value: 'Updated DAO Name' },
            { key: 'description', value: 'Updated description' },
            { key: 'image_url', value: 'https://example.com/image.png' },
            { key: '_contract_address', value: 'juno1dao123contract456' },
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
        addresses: ['juno1dao123contract456'],
      })
    })

    it('should match admin nomination acceptance', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute_accept_admin_nomination' },
            { key: 'new_admin', value: 'juno1newadmin123' },
            { key: '_contract_address', value: 'juno1dao123contract456' },
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
        addresses: ['juno1dao123contract456'],
      })
    })

    it('should match proposal hook execution', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute_proposal_hook' },
            { key: '_contract_address', value: 'juno1dao123contract456' },
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
        addresses: ['juno1dao123contract456'],
      })
    })

    it('should not match config update without required attributes', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute_update_config' },
            // Missing name, description, or image_url
            { key: '_contract_address', value: 'juno1dao123contract456' },
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

    it('should not match admin nomination without new_admin', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute_accept_admin_nomination' },
            // Missing new_admin attribute
            { key: '_contract_address', value: 'juno1dao123contract456' },
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

    it('should combine instantiation and execution addresses', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '4862' },
            { key: '_contract_address', value: 'juno1dao123contract456' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute_proposal_hook' },
            { key: '_contract_address', value: 'juno1dao789contract012' },
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
        addresses: ['juno1dao123contract456', 'juno1dao789contract012'],
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
      info: {
        contract: 'crates.io:dao-dao-core',
        version: '2.4.0',
      },
    }

    const mockDumpState = {
      admin: 'juno1admin123',
      config: {
        name: 'Test DAO',
        description: 'A test DAO for testing',
      },
      version: { version: '2.4.0' },
      proposal_modules: [],
      voting_module: 'juno1voting123',
    }

    beforeEach(async () => {
      // Create a test block in the database
      await Block.createOne({
        height: 1000,
        timeUnixMs: 1640995200000,
      })

      // Mock the client methods
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockResolvedValue({
        address: 'juno1dao123contract456',
        codeId: 4862,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test DAO',
        ibcPortId: 'juno1ibc123',
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // First call for info
        .mockResolvedValueOnce(mockDumpState) // Second call for dump_state
    })

    it('should extract DAO information successfully', async () => {
      const data: DaoExtractorData = {
        addresses: ['juno1dao123contract456'],
      }

      const result = (await extractor.extract({
        txHash: 'test-hash-123',
        height: '1000',
        data,
      })) as Extraction[]

      expect(mockAutoCosmWasmClient.update).toHaveBeenCalled()
      expect(mockAutoCosmWasmClient.client!.getContract).toHaveBeenCalledWith(
        'juno1dao123contract456'
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(2)
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { info: {} })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { dump_state: {} })

      expect(result).toHaveLength(2)

      // Check info extraction
      const infoExtraction = result.find((e) => e.name === 'dao-dao-core/info')
      expect(infoExtraction).toBeDefined()
      expect(infoExtraction!.address).toBe('juno1dao123contract456')
      expect(infoExtraction!.blockHeight).toBe('1000')
      expect(infoExtraction!.txHash).toBe('test-hash-123')
      expect(infoExtraction!.data).toEqual(mockContractInfo)

      // Check dump_state extraction
      const dumpStateExtraction = result.find(
        (e) => e.name === 'dao-dao-core/dump_state'
      )
      expect(dumpStateExtraction).toBeDefined()
      expect(dumpStateExtraction!.address).toBe('juno1dao123contract456')
      expect(dumpStateExtraction!.blockHeight).toBe('1000')
      expect(dumpStateExtraction!.txHash).toBe('test-hash-123')
      expect(dumpStateExtraction!.data).toEqual(mockDumpState)
    })

    it('should handle multiple DAO addresses', async () => {
      const data: DaoExtractorData = {
        addresses: ['juno1dao123contract456', 'juno1dao789contract012'],
      }

      // Mock additional contract calls
      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
        .mockResolvedValueOnce({
          address: 'juno1dao123contract456',
          codeId: 4862,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test DAO 1',
          ibcPortId: 'juno1ibc123',
        })
        .mockResolvedValueOnce({
          address: 'juno1dao789contract012',
          codeId: 4862,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test DAO 2',
          ibcPortId: 'juno1ibc456',
        })

      // Mock query calls for both contracts
      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // info for first contract
        .mockResolvedValueOnce(mockDumpState) // dump_state for first contract
        .mockResolvedValueOnce(mockContractInfo) // info for second contract
        .mockResolvedValueOnce(mockDumpState) // dump_state for second contract

      const result = (await extractor.extract({
        txHash: 'test-hash-456',
        height: '1000',
        data,
      })) as Extraction[]

      expect(result).toHaveLength(4) // 2 extractions per contract

      const addresses = result.map((r) => r.address)
      expect(addresses).toContain('juno1dao123contract456')
      expect(addresses).toContain('juno1dao789contract012')
    })

    it('should handle contract query failures gracefully', async () => {
      const data: DaoExtractorData = {
        addresses: ['juno1dao123contract456', 'juno1dao789contract012'],
      }

      // Mock one successful and one failing contract
      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
        .mockResolvedValueOnce({
          address: 'juno1dao123contract456',
          codeId: 4862,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test DAO 1',
          ibcPortId: undefined,
        })
        .mockResolvedValueOnce({
          address: 'juno1dao789contract012',
          codeId: 4862,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test DAO 2',
          ibcPortId: undefined,
        })

      // Mock successful queries for first contract, failed for second
      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, queryMsg: any) => {
        // First contract
        if (address === 'juno1dao123contract456') {
          if (queryMsg.info) {
            return mockContractInfo
          } else if (queryMsg.dump_state) {
            return mockDumpState
          } else {
            throw new Error('Unknown query')
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
          id: '1',
          address: 'juno1dao123contract456',
          name: 'dao-dao-core/info',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash-789',
          data: mockContractInfo,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '2',
          address: 'juno1dao123contract456',
          name: 'dao-dao-core/dump_state',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash-789',
          data: mockDumpState,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should get block time from RPC when not in database', async () => {
      const data: DaoExtractorData = {
        addresses: ['juno1dao123contract456'],
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
      expect(result).toHaveLength(2)
      expect(result[0].blockTimeUnixMs).toBe(
        Date.parse('2022-01-01T01:00:00Z').toString()
      )
    })

    it('should create contracts in database with correct information', async () => {
      const data: DaoExtractorData = {
        addresses: ['juno1dao123contract456'],
      }

      await extractor.extract({
        txHash: 'test-hash-contract',
        height: '1000',
        data,
      })

      // Check that contract was created in database
      const contract = await Contract.findByPk('juno1dao123contract456')
      expect(contract).toBeDefined()
      expect(contract!.codeId).toBe(4862)
      expect(contract!.admin).toBe('juno1admin123')
      expect(contract!.creator).toBe('juno1creator123')
      expect(contract!.label).toBe('Test DAO')
      expect(contract!.instantiatedAtBlockHeight).toBe('1000')
      expect(contract!.instantiatedAtBlockTimeUnixMs).toBe('1640995200000')
    })

    it('should throw error when client is not connected', async () => {
      // Mock client as undefined
      const brokenAutoClient = {
        ...mockAutoCosmWasmClient,
        client: undefined,
      }

      const brokenExtractor = await dao({
        config: ConfigManager.load(),
        sendWebhooks: false,
        autoCosmWasmClient: brokenAutoClient as any,
      })

      const data: DaoExtractorData = {
        addresses: ['juno1dao123contract456'],
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
