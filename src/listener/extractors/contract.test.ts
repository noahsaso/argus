import { toUtf8 } from '@cosmjs/encoding'
import { MockInstance, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Contract, Extraction } from '@/db'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'
import * as utils from '@/utils'

import { WasmInstantiateOrMigrateDataSource } from '../sources'
import { ContractExtractor } from './contract'

describe('Contracts Extractor', () => {
  let mockAutoCosmWasmClient: utils.AutoCosmWasmClient
  let extractor: ContractExtractor
  let queryContractRawMock: MockInstance
  let getContractMock: MockInstance

  beforeEach(async () => {
    vi.clearAllMocks()

    queryContractRawMock = vi.fn()
    getContractMock = vi.spyOn(utils, 'getContractInfo')

    // Create mock AutoCosmWasmClient
    const mockClient: any = {
      getBlock: vi.fn(),
      getHeight: vi.fn(),
      getCodes: vi.fn(),
      getContracts: vi.fn(),
      forceGetQueryClient: vi.fn().mockReturnValue({
        wasm: {
          queryContractRaw: queryContractRawMock,
        },
      }),
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

    extractor = new ContractExtractor(env)
  })

  describe('data sources configuration', () => {
    it('should have correct data sources configured', () => {
      expect(extractor.sources).toHaveLength(1)

      const instantiateSource = extractor.sources.find(
        (s) => s.type === WasmInstantiateOrMigrateDataSource.type
      )
      expect(instantiateSource).toBeDefined()
      expect(instantiateSource!.handler).toBe('instantiate')
    })

    it('should have correct static type', () => {
      expect(ContractExtractor.type).toBe('contract')
    })
  })

  describe('extract function', () => {
    const mockContractInfo = {
      contract: 'crates.io:some-contract',
      version: '2.3.4',
    }

    it('should extract contract information from instantiate data successfully', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno123contract456',
          codeId: 4862,
          codeIdsKeys: [],
        }),
      ]

      // Mock the client methods
      getContractMock.mockResolvedValue({
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

      const result = (await extractor.extract(data)) as Extraction[]

      expect(getContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'juno123contract456',
        })
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
      expect(infoExtraction!.txHash).toBe('test-hash')
      expect(infoExtraction!.data).toEqual(mockContractInfo)
    })

    it('should extract contract information from migrate data successfully', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'migrate',
          address: 'juno123contract456',
          codeId: 4862,
          codeIdsKeys: [],
        }),
      ]

      // Mock the client methods
      getContractMock.mockResolvedValue({
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

      const result = (await extractor.extract(data)) as Extraction[]

      expect(getContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'juno123contract456',
        })
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
      expect(infoExtraction!.txHash).toBe('test-hash')
      expect(infoExtraction!.data).toEqual(mockContractInfo)
    })

    it('should handle multiple addresses', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno123contract456',
          codeId: 4862,
          codeIdsKeys: [],
        }),
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno789contract012',
          codeId: 4862,
          codeIdsKeys: [],
        }),
      ]

      // Mock additional contract calls
      getContractMock
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

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(2) // 1 extraction per contract

      const addresses = result.map((r) => r.address)
      expect(addresses).toContain('juno123contract456')
      expect(addresses).toContain('juno789contract012')
    })

    it('should throw error on contract query failure', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno123contract456',
          codeId: 4862,
          codeIdsKeys: [],
        }),
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno789contract012',
          codeId: 4862,
          codeIdsKeys: [],
        }),
      ]

      // Mock one successful and one failing contract
      getContractMock.mockImplementation(
        async ({ address }: { address: string }) => {
          if (address === 'juno123contract456') {
            return {
              address: 'juno123contract456',
              codeId: 4862,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test Contract 1',
              ibcPortId: undefined,
            }
          } else if (address === 'juno789contract012') {
            return {
              address: 'juno789contract012',
              codeId: 4862,
              admin: 'juno1admin456',
              creator: 'juno1creator456',
              label: 'Test Contract 2',
              ibcPortId: undefined,
            }
          }
          throw new Error('Unknown contract')
        }
      )

      // Mock successful queries for first contract, failed for second
      queryContractRawMock.mockImplementation(async (address: string) => {
        // First contract
        if (address === 'juno123contract456') {
          return {
            data: toUtf8(JSON.stringify(mockContractInfo)),
          }
        }
        // Second contract
        throw new Error('Query failed')
      })

      await expect(extractor.extract(data)).rejects.toThrow('Query failed')
    })

    it('should create contracts in database with correct information', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno123contract456',
          codeId: 4862,
          codeIdsKeys: [],
        }),
      ]

      // Mock the client methods
      getContractMock.mockResolvedValue({
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

      await extractor.extract(data)

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

    it('should not extract when contract info query returns empty data', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno123contract456',
          codeId: 4862,
          codeIdsKeys: [],
        }),
      ]

      // Mock the client methods
      getContractMock.mockResolvedValue({
        address: 'juno123contract456',
        codeId: 4862,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test Contract',
        ibcPortId: 'juno1ibc123',
      })

      // Mock empty response
      queryContractRawMock.mockResolvedValueOnce({
        data: new Uint8Array(0),
      })

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(0)
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

      const brokenExtractor = new ContractExtractor(brokenEnv)

      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno123contract456',
          codeId: 4862,
          codeIdsKeys: [],
        }),
      ]

      await expect(brokenExtractor.extract(data)).rejects.toThrow(
        'CosmWasm client not connected'
      )
    })
  })

  describe('sync function', () => {
    it('should sync contract addresses', async () => {
      vi.mocked(mockAutoCosmWasmClient.client!.getCodes).mockResolvedValue([
        { id: 100, creator: 'juno1creator1', checksum: 'checksum1' },
        { id: 200, creator: 'juno1creator2', checksum: 'checksum2' },
      ])

      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 100) {
            return ['juno1contract100']
          } else if (codeId === 200) {
            return ['juno1contract200']
          } else {
            return []
          }
        }
      )

      const result = await Array.fromAsync(
        ContractExtractor.sync!({
          config: extractor.env.config,
          autoCosmWasmClient: extractor.env.autoCosmWasmClient,
        })
      )

      expect(result).toEqual([
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1contract100',
            codeId: 100,
            codeIdsKeys: [],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1contract200',
            codeId: 200,
            codeIdsKeys: [],
          },
        },
      ])
    })
  })
})
