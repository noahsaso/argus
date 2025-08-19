import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Contract, Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'
import { AutoCosmWasmClient } from '@/utils'

import {
  WasmEventDataSource,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { DaoExtractor } from './dao'

describe('DAO Extractor', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let extractor: DaoExtractor

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    vi.spyOn(instance, 'findWasmCodeIdsByKeys').mockImplementation(
      (...keys: string[]) => {
        if (keys.includes('dao-dao-core')) {
          return [4862, 163] // Mocked code IDs
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
        getContracts: vi.fn(),
        queryContractSmart: vi.fn(),
        getBlock: vi.fn(),
        getHeight: vi.fn(),
      },
    } as any

    // Set up the extractor environment
    const env: ExtractorEnv = {
      config: ConfigManager.load(),
      sendWebhooks: false,
      autoCosmWasmClient: mockAutoCosmWasmClient,
      txHash: 'test-hash',
      block: {
        height: '1000',
        timeUnixMs: '1640995200000',
        timestamp: '2022-01-01T01:00:00Z',
      },
    }

    extractor = new DaoExtractor(env)
  })

  describe('data sources configuration', () => {
    it('should have correct data sources configured', () => {
      expect(extractor.sources).toHaveLength(4)

      const instantiateSource = extractor.sources.find(
        (s) => s.type === WasmInstantiateOrMigrateDataSource.type
      )
      expect(instantiateSource).toBeDefined()
      expect(instantiateSource!.handler).toBe('instantiate')
      expect(instantiateSource!.config).toEqual({
        codeIdsKeys: ['dao-dao-core'],
      })

      const executeSourceConfigs = extractor.sources.filter(
        (s) => s.type === WasmEventDataSource.type
      )
      expect(executeSourceConfigs).toHaveLength(3)
      expect(executeSourceConfigs.every((s) => s.handler === 'execute')).toBe(
        true
      )
    })

    it('should have correct static type', () => {
      expect(DaoExtractor.type).toBe('dao')
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

    it('should extract DAO information successfully from instantiate data', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 4862,
          codeIdsKeys: ['dao-dao-core'],
        }),
      ]

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

      const result = (await extractor.extract(data)) as Extraction[]

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
      const infoExtraction = result.find((e) => e.name === 'info')
      expect(infoExtraction).toBeDefined()
      expect(infoExtraction!.address).toBe('juno1dao123contract456')
      expect(infoExtraction!.blockHeight).toBe('1000')
      expect(infoExtraction!.txHash).toBe('test-hash')
      expect(infoExtraction!.data).toEqual(mockContractInfo.info)

      // Check dump_state extraction
      const dumpStateExtraction = result.find(
        (e) => e.name === 'dao-dao-core/dump_state'
      )
      expect(dumpStateExtraction).toBeDefined()
      expect(dumpStateExtraction!.address).toBe('juno1dao123contract456')
      expect(dumpStateExtraction!.blockHeight).toBe('1000')
      expect(dumpStateExtraction!.txHash).toBe('test-hash')
      expect(dumpStateExtraction!.data).toEqual(mockDumpState)
    })

    it('should extract DAO information successfully from execute data', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1dao123contract456',
          key: 'action',
          value: 'execute_update_config',
          attributes: {
            _contract_address: ['juno1dao123contract456'],
            action: ['execute_update_config'],
            name: ['Test DAO'],
            description: ['A test DAO for testing'],
            image_url: ['https://moonphase.wtf/image.svg'],
          },
          _attributes: [
            { key: '_contract_address', value: 'juno1dao123contract456' },
            { key: 'action', value: 'execute_update_config' },
            { key: 'name', value: 'Test DAO' },
            { key: 'description', value: 'A test DAO for testing' },
            { key: 'image_url', value: 'https://moonphase.wtf/image.svg' },
          ],
        }),
      ]

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

      const result = (await extractor.extract(data)) as Extraction[]

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
      const infoExtraction = result.find((e) => e.name === 'info')
      expect(infoExtraction).toBeDefined()
      expect(infoExtraction!.address).toBe('juno1dao123contract456')
      expect(infoExtraction!.blockHeight).toBe('1000')
      expect(infoExtraction!.txHash).toBe('test-hash')
      expect(infoExtraction!.data).toEqual(mockContractInfo.info)

      // Check dump_state extraction
      const dumpStateExtraction = result.find(
        (e) => e.name === 'dao-dao-core/dump_state'
      )
      expect(dumpStateExtraction).toBeDefined()
      expect(dumpStateExtraction!.address).toBe('juno1dao123contract456')
      expect(dumpStateExtraction!.blockHeight).toBe('1000')
      expect(dumpStateExtraction!.txHash).toBe('test-hash')
      expect(dumpStateExtraction!.data).toEqual(mockDumpState)
    })

    it('should handle multiple DAO addresses', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 4862,
          codeIdsKeys: ['dao-dao-core'],
        }),
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao789contract012',
          codeId: 4862,
          codeIdsKeys: ['dao-dao-core'],
        }),
      ]

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

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(4) // 2 extractions per contract

      const addresses = result.map((r) => r.address)
      expect(addresses).toContain('juno1dao123contract456')
      expect(addresses).toContain('juno1dao789contract012')
    })

    it('should not extract if contract is not a dao-dao-core contract', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 4862,
          codeIdsKeys: ['dao-dao-core'],
        }),
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao789contract012',
          codeId: 9999,
          codeIdsKeys: [],
        }),
      ]

      // Mock one correct code ID and one incorrect code ID
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockImplementation(
        async (address: string) => {
          if (address === 'juno1dao123contract456') {
            return {
              address: 'juno1dao123contract456',
              codeId: 4862,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test DAO',
              ibcPortId: 'juno1ibc123',
            }
          } else {
            return {
              address: 'juno1dao789contract012',
              codeId: 9999,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test DAO',
              ibcPortId: 'juno1ibc123',
            }
          }
        }
      )

      // Mock successful queries for first contract only
      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (_, queryMsg: any) => {
        if (queryMsg.info) {
          return mockContractInfo
        } else if (queryMsg.dump_state) {
          return mockDumpState
        } else {
          throw new Error('Unknown query')
        }
      })

      const result = (await extractor.extract(data)) as Extraction[]

      // Should only have extractions for the dao-dao-core contract
      expect(result.map((r) => r.toJSON())).toEqual([
        {
          id: '1',
          address: 'juno1dao123contract456',
          name: 'info',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockContractInfo.info,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '2',
          address: 'juno1dao123contract456',
          name: 'dao-dao-core/dump_state',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockDumpState,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should create contracts in database with correct information', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 4862,
          codeIdsKeys: ['dao-dao-core'],
        }),
      ]

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

      await extractor.extract(data)

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

      const brokenEnv: ExtractorEnv = {
        config: ConfigManager.load(),
        sendWebhooks: false,
        autoCosmWasmClient: brokenAutoClient as any,
        txHash: 'test-hash-error',
        block: {
          height: '1000',
          timeUnixMs: '1640995200000',
          timestamp: '2022-01-01T01:00:00Z',
        },
      }

      const brokenExtractor = new DaoExtractor(brokenEnv)

      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 4862,
          codeIdsKeys: ['dao-dao-core'],
        }),
      ]

      await expect(brokenExtractor.extract(data)).rejects.toThrow(
        'CosmWasm client not connected'
      )
    })
  })

  describe('sync function', () => {
    it('should sync DAO addresses', async () => {
      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 4862) {
            return ['juno1dao123contract456']
          } else if (codeId === 163) {
            return ['juno1dao789contract012']
          } else {
            return []
          }
        }
      )

      const result = await Array.fromAsync(
        DaoExtractor.sync!({
          config: extractor.env.config,
          autoCosmWasmClient: extractor.env.autoCosmWasmClient,
        })
      )

      expect(result).toEqual([
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1dao123contract456',
            codeId: 4862,
            codeIdsKeys: ['dao-dao-core'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1dao789contract012',
            codeId: 163,
            codeIdsKeys: ['dao-dao-core'],
          },
        },
      ])
    })
  })
})
