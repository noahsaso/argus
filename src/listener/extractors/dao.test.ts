import {
  MockInstance,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { ConfigManager } from '@/config'
import { Contract, Extraction } from '@/db'
import { WasmCode, WasmCodeService } from '@/services'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'
import * as utils from '@/utils'

import {
  WasmEventDataSource,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { DaoExtractor } from './dao'

describe('DAO Extractor', () => {
  let mockAutoCosmWasmClient: utils.AutoCosmWasmClient
  let extractor: DaoExtractor
  let getContractMock: MockInstance

  const mockContractInfo = {
    info: {
      contract: 'crates.io:dao-dao-core',
      version: '2.4.0',
    },
  }

  const mockConfig = {
    name: 'Test DAO',
    description: 'A test DAO for testing',
  }

  const mockDumpState = {
    admin: 'juno1admin123',
    config: mockConfig,
    version: { version: '2.4.0' },
    proposal_modules: [
      {
        address: 'juno1proposal123',
        prefix: 'A',
        status: 'Enabled',
      },
      {
        address: 'juno1proposal456',
        prefix: 'B',
        status: 'Enabled',
      },
    ],
    voting_module: 'juno1voting123',
  }

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    instance.addDefaultWasmCodes(new WasmCode('dao-dao-core', [1, 2]))
    instance.addDefaultWasmCodes(new WasmCode('dao-voting', [3]))
    instance.addDefaultWasmCodes(new WasmCode('dao-proposal', [4]))
  })

  beforeEach(async () => {
    vi.clearAllMocks()

    getContractMock = vi.spyOn(utils, 'getContractInfo')

    // Create mock AutoCosmWasmClient
    const mockClient: any = {
      getContracts: vi.fn(),
      queryContractSmart: vi.fn(),
      getBlock: vi.fn(),
      getHeight: vi.fn(),
    }
    mockAutoCosmWasmClient = {
      update: vi.fn(),
      client: mockClient,
      getValidClient: vi.fn().mockResolvedValue(mockClient),
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
    it('should extract DAO information successfully from instantiate data', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 1,
          codeIdsKeys: ['dao-dao-core'],
        }),
      ]

      // Mock the client methods
      getContractMock.mockResolvedValue({
        address: 'juno1dao123contract456',
        codeId: 1,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test DAO',
        ibcPortId: 'juno1ibc123',
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // First call for info
        .mockResolvedValueOnce(mockDumpState) // Second call for dump_state
        .mockResolvedValueOnce(mockConfig) // Third call for config

      const result = (await extractor.extract(data)) as Extraction[]

      expect(getContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'juno1dao123contract456',
        })
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(3)
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { info: {} })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { dump_state: {} })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { config: {} })

      expect(result).toHaveLength(5) // 1 info, 1 dump_state, 1 config, 2 proposal modules

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

      // Check config extraction
      const configExtraction = result.find(
        (e) => e.name === 'dao-dao-core/config'
      )
      expect(configExtraction).toBeDefined()
      expect(configExtraction!.address).toBe('juno1dao123contract456')
      expect(configExtraction!.blockHeight).toBe('1000')
      expect(configExtraction!.txHash).toBe('test-hash')
      expect(configExtraction!.data).toEqual(mockConfig)

      // Check proposal modules extraction
      const proposalModulesExtraction = result.filter((e) =>
        e.name.startsWith('proposalModule:')
      )
      expect(proposalModulesExtraction).toHaveLength(2)
      expect(proposalModulesExtraction[0].name).toBe(
        'proposalModule:juno1proposal123'
      )
      expect(proposalModulesExtraction[0].data).toEqual({
        address: 'juno1proposal123',
        prefix: 'A',
        status: 'Enabled',
      })
      expect(proposalModulesExtraction[1].name).toBe(
        'proposalModule:juno1proposal456'
      )
      expect(proposalModulesExtraction[1].data).toEqual({
        address: 'juno1proposal456',
        prefix: 'B',
        status: 'Enabled',
      })
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
      getContractMock.mockResolvedValue({
        address: 'juno1dao123contract456',
        codeId: 1,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test DAO',
        ibcPortId: 'juno1ibc123',
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // First call for info
        .mockResolvedValueOnce(mockDumpState) // Second call for dump_state
        .mockResolvedValueOnce(mockConfig) // Third call for config

      const result = (await extractor.extract(data)) as Extraction[]

      expect(getContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'juno1dao123contract456',
        })
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(3)
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { info: {} })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { dump_state: {} })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1dao123contract456', { config: {} })

      expect(result).toHaveLength(3)

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

      // Check config extraction
      const configExtraction = result.find(
        (e) => e.name === 'dao-dao-core/config'
      )
      expect(configExtraction).toBeDefined()
      expect(configExtraction!.address).toBe('juno1dao123contract456')
      expect(configExtraction!.blockHeight).toBe('1000')
      expect(configExtraction!.txHash).toBe('test-hash')
      expect(configExtraction!.data).toEqual(mockConfig)
    })

    it('should handle multiple DAO addresses', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 1,
          codeIdsKeys: ['dao-dao-core'],
        }),
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao789contract012',
          codeId: 1,
          codeIdsKeys: ['dao-dao-core'],
        }),
      ]

      // Mock additional contract calls
      getContractMock
        .mockResolvedValueOnce({
          address: 'juno1dao123contract456',
          codeId: 1,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test DAO 1',
          ibcPortId: 'juno1ibc123',
        })
        .mockResolvedValueOnce({
          address: 'juno1dao789contract012',
          codeId: 1,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test DAO 2',
          ibcPortId: 'juno1ibc456',
        })

      // Mock query calls for both contracts
      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // info for first contract
        .mockResolvedValueOnce(mockDumpState) // dump_state for first contract
        .mockResolvedValueOnce(mockConfig) // config for first contract
        .mockResolvedValueOnce(mockContractInfo) // info for second contract
        .mockResolvedValueOnce(mockDumpState) // dump_state for second contract
        .mockResolvedValueOnce(mockConfig) // config for second contract

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(10) // 5 extractions per contract

      const addresses = result.map((r) => r.address)
      expect(addresses).toContain('juno1dao123contract456')
      expect(addresses).toContain('juno1dao789contract012')
    })

    it('should not extract if contract is not a dao-dao-core contract', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1dao123contract456',
          codeId: 1,
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
      getContractMock.mockImplementation(
        async ({ address }: { address: string }) => {
          if (address === 'juno1dao123contract456') {
            return {
              address: 'juno1dao123contract456',
              codeId: 1,
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
        } else if (queryMsg.config) {
          return mockConfig
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
        {
          id: '3',
          address: 'juno1dao123contract456',
          name: 'dao-dao-core/config',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockConfig,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '4',
          address: 'juno1dao123contract456',
          name: 'proposalModule:juno1proposal123',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockDumpState.proposal_modules[0],
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '5',
          address: 'juno1dao123contract456',
          name: 'proposalModule:juno1proposal456',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockDumpState.proposal_modules[1],
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
          codeId: 1,
          codeIdsKeys: ['dao-dao-core'],
        }),
      ]

      // Mock the client methods
      getContractMock.mockResolvedValue({
        address: 'juno1dao123contract456',
        codeId: 1,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test DAO',
        ibcPortId: 'juno1ibc123',
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // First call for info
        .mockResolvedValueOnce(mockDumpState) // Second call for dump_state
        .mockResolvedValueOnce(mockConfig) // Third call for config

      await extractor.extract(data)

      // Check that contract was created in database
      const contract = await Contract.findByPk('juno1dao123contract456')
      expect(contract).toBeDefined()
      expect(contract!.codeId).toBe(1)
      expect(contract!.admin).toBe('juno1admin123')
      expect(contract!.creator).toBe('juno1creator123')
      expect(contract!.label).toBe('Test DAO')
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
          codeId: 1,
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

      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 1) {
            return ['juno1dao123contract456']
          } else if (codeId === 2) {
            return ['juno1dao789contract012']
          } else {
            return []
          }
        }
      )

      getContractMock.mockImplementation(
        async ({ address }: { address: string }) => {
          if (address === 'juno1voting123') {
            return {
              codeId: 3,
            } as any
          } else if (
            address === 'juno1proposal123' ||
            address === 'juno1proposal456'
          ) {
            return {
              codeId: 4,
            } as any
          } else {
            return {
              codeId: 5,
            } as any
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
            codeId: 1,
            codeIdsKeys: ['dao-dao-core'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1voting123',
            codeId: 3,
            codeIdsKeys: ['dao-voting'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1proposal123',
            codeId: 4,
            codeIdsKeys: ['dao-proposal'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1proposal456',
            codeId: 4,
            codeIdsKeys: ['dao-proposal'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1dao789contract012',
            codeId: 2,
            codeIdsKeys: ['dao-dao-core'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1voting123',
            codeId: 3,
            codeIdsKeys: ['dao-voting'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1proposal123',
            codeId: 4,
            codeIdsKeys: ['dao-proposal'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1proposal456',
            codeId: 4,
            codeIdsKeys: ['dao-proposal'],
          },
        },
      ])
    })
  })
})
