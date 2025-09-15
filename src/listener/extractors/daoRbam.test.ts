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
import { DaoRbamExtractor } from './daoRbam'

describe('DAO RBAM Extractor', () => {
  let mockAutoCosmWasmClient: utils.AutoCosmWasmClient
  let extractor: DaoRbamExtractor
  let getContractMock: MockInstance

  const mockInfo = {
    info: { contract: 'crates.io:dao-rbam', version: '1.0.0' },
  }
  const mockDao = { dao: 'juno1daoaddress' }
  const mockAssignments = { assignments: [{ addr: 'juno1user', role_id: 1 }] }
  const mockRoles = { roles: [{ id: 1, name: 'Administrator' }] }

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    instance.addDefaultWasmCodes(new WasmCode('dao-rbam', [9999, 2001]))
  })

  beforeEach(async () => {
    vi.clearAllMocks()

    getContractMock = vi.spyOn(utils, 'getContractInfo')

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

    extractor = new DaoRbamExtractor(env)
  })

  describe('data sources configuration', () => {
    it('should have correct data sources configured', () => {
      expect(extractor.sources).toHaveLength(2)

      const instantiateSource = extractor.sources.find(
        (s) => s.type === WasmInstantiateOrMigrateDataSource.type
      )
      expect(instantiateSource).toBeDefined()
      expect(instantiateSource!.handler).toBe('instantiate')
      expect(instantiateSource!.config).toEqual({
        codeIdsKeys: ['dao-rbam'],
      })

      const executeSource = extractor.sources.find(
        (s) => s.type === WasmEventDataSource.type
      )
      expect(executeSource).toBeDefined()
      expect(executeSource!.handler).toBe('execute')
      expect(executeSource!.config).toEqual({
        key: 'action',
        value: ['create_role', 'update_role', 'assign', 'revoke'],
      })
    })

    it('should have correct static type', () => {
      expect(DaoRbamExtractor.type).toBe('dao-rbam')
    })
  })

  describe('extract function', () => {
    it('should extract RBAM info from instantiate data', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1rbamcontract1',
          codeId: 9999,
          codeIdsKeys: ['dao-rbam'],
        }),
      ]

      getContractMock.mockResolvedValue({
        address: 'juno1rbamcontract1',
        codeId: 9999,
        admin: 'juno1admin',
        creator: 'juno1creator',
        label: 'RBAM Contract 1',
        ibcPortId: undefined,
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockInfo) // info
        .mockResolvedValueOnce(mockDao) // dao
        .mockResolvedValueOnce(mockAssignments) // list_assignments
        .mockResolvedValueOnce(mockRoles) // list_roles

      const result = (await extractor.extract(data)) as Extraction[]

      expect(getContractMock).toHaveBeenCalledWith(
        expect.objectContaining({ address: 'juno1rbamcontract1' })
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(4)

      const names = result.map((e) => e.name).sort()
      expect(names).toEqual(
        [
          'dao-rbam/info',
          'dao-rbam/dao',
          'dao-rbam/list_assignments',
          'dao-rbam/list_roles',
        ].sort()
      )

      for (const r of result) {
        expect(r.address).toBe('juno1rbamcontract1')
        expect(r.blockHeight).toBe('1000')
        expect(r.txHash).toBe('test-hash')
      }
    })

    it('should extract RBAM info from execute data', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1rbamcontract2',
          key: 'action',
          value: 'assign',
          attributes: {
            _contract_address: ['juno1rbamcontract2'],
            action: ['assign'],
          },
          _attributes: [
            { key: '_contract_address', value: 'juno1rbamcontract2' },
            { key: 'action', value: 'assign' },
          ],
        }),
      ]

      getContractMock.mockResolvedValue({
        address: 'juno1rbamcontract2',
        codeId: 9999,
        admin: 'juno1admin2',
        creator: 'juno1creator2',
        label: 'RBAM Contract 2',
        ibcPortId: undefined,
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockInfo)
        .mockResolvedValueOnce(mockDao)
        .mockResolvedValueOnce(mockAssignments)
        .mockResolvedValueOnce(mockRoles)

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(4)
      const names = result.map((e) => e.name).sort()
      expect(names).toEqual(
        [
          'dao-rbam/info',
          'dao-rbam/dao',
          'dao-rbam/list_assignments',
          'dao-rbam/list_roles',
        ].sort()
      )
    })

    it('should handle multiple RBAM addresses', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1rbamcontract1',
          codeId: 9999,
          codeIdsKeys: ['dao-rbam'],
        }),
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1rbamcontract2',
          codeId: 2001,
          codeIdsKeys: ['dao-rbam'],
        }),
      ]

      getContractMock
        .mockResolvedValueOnce({
          address: 'juno1rbamcontract1',
          codeId: 9999,
          admin: 'juno1admin',
          creator: 'juno1creator',
          label: 'RBAM Contract 1',
          ibcPortId: undefined,
        })
        .mockResolvedValueOnce({
          address: 'juno1rbamcontract2',
          codeId: 2001,
          admin: 'juno1admin2',
          creator: 'juno1creator2',
          label: 'RBAM Contract 2',
          ibcPortId: undefined,
        })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        // contract 1
        .mockResolvedValueOnce(mockInfo)
        .mockResolvedValueOnce(mockDao)
        // contract 2
        .mockResolvedValueOnce(mockInfo)
        .mockResolvedValueOnce(mockDao)

        // contract 1
        .mockResolvedValueOnce(mockAssignments)
        // contract 2
        .mockResolvedValueOnce(mockAssignments)

        // contract 1
        .mockResolvedValueOnce(mockRoles)
        // contract 2
        .mockResolvedValueOnce(mockRoles)

      const result = (await extractor.extract(data)) as Extraction[]
      expect(result).toHaveLength(8) // 4 per contract
      const addresses = result.map((r) => r.address)
      expect(addresses).toContain('juno1rbamcontract1')
      expect(addresses).toContain('juno1rbamcontract2')
    })

    it('should not extract if contract is not a dao-rbam contract', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1rbamcontract1',
          codeId: 9999,
          codeIdsKeys: ['dao-rbam'],
        }),
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1notrbam',
          codeId: 1234,
          codeIdsKeys: [], // not dao-rbam
        }),
      ]

      getContractMock.mockImplementation(
        async ({ address }: { address: string }) => {
          if (address === 'juno1rbamcontract1') {
            return {
              address,
              codeId: 9999,
              admin: 'juno1admin',
              creator: 'juno1creator',
              label: 'RBAM Contract 1',
              ibcPortId: undefined,
            }
          }
          return {
            address,
            codeId: 1234,
            admin: 'juno1otheradmin',
            creator: 'juno1othercreator',
            label: 'Other',
            ibcPortId: undefined,
          }
        }
      )

      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (_, queryMsg: any) => {
        if (queryMsg.info) return mockInfo
        if (queryMsg.dao) return mockDao
        if (queryMsg.list_assignments) return mockAssignments
        if (queryMsg.list_roles) return mockRoles
        throw new Error('Unknown query')
      })

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result.map((r) => r.toJSON())).toEqual([
        {
          id: '1',
          address: 'juno1rbamcontract1',
          name: 'dao-rbam/info',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockInfo,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '2',
          address: 'juno1rbamcontract1',
          name: 'dao-rbam/dao',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockDao,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '3',
          address: 'juno1rbamcontract1',
          name: 'dao-rbam/list_assignments',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockAssignments.assignments,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '4',
          address: 'juno1rbamcontract1',
          name: 'dao-rbam/list_roles',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: mockRoles.roles,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should create/overwrite Contract row with correct info', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1rbamcontract1',
          codeId: 9999,
          codeIdsKeys: ['dao-rbam'],
        }),
      ]

      getContractMock.mockResolvedValue({
        address: 'juno1rbamcontract1',
        codeId: 9999,
        admin: 'juno1admin',
        creator: 'juno1creator',
        label: 'RBAM Contract 1',
        ibcPortId: undefined,
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockInfo)
        .mockResolvedValueOnce(mockDao)
        .mockResolvedValueOnce(mockAssignments)
        .mockResolvedValueOnce(mockRoles)

      await extractor.extract(data)

      const contract = await Contract.findByPk('juno1rbamcontract1')
      expect(contract).toBeDefined()
      expect(contract!.codeId).toBe(9999)
      expect(contract!.admin).toBe('juno1admin')
      expect(contract!.creator).toBe('juno1creator')
      expect(contract!.label).toBe('RBAM Contract 1')
    })

    it('should throw error when client is not connected', async () => {
      const brokenEnv: ExtractorEnv = {
        config: ConfigManager.load(),
        sendWebhooks: false,
        autoCosmWasmClient: {
          ...mockAutoCosmWasmClient,
          client: undefined,
        } as any,
        txHash: 'test-hash-error',
        block: {
          height: '1000',
          timeUnixMs: '1640995200000',
          timestamp: '2022-01-01T01:00:00Z',
        },
      }

      const brokenExtractor = new DaoRbamExtractor(brokenEnv)

      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1rbamcontract1',
          codeId: 9999,
          codeIdsKeys: ['dao-rbam'],
        }),
      ]

      await expect(brokenExtractor.extract(data)).rejects.toThrow(
        'CosmWasm client not connected'
      )
    })
  })

  describe('sync function', () => {
    it('should sync RBAM addresses (instantiate seeds)', async () => {
      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 9999) return ['juno1rbamA', 'juno1rbamB']
          if (codeId === 2001) return ['juno1rbamC']
          return []
        }
      )

      const result = await Array.fromAsync(
        DaoRbamExtractor.sync!({
          config: extractor.env.config,
          autoCosmWasmClient: extractor.env.autoCosmWasmClient,
        })
      )

      expect(result).toEqual([
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1rbamA',
            codeId: 9999,
            codeIdsKeys: ['dao-rbam'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1rbamB',
            codeId: 9999,
            codeIdsKeys: ['dao-rbam'],
          },
        },
        {
          source: WasmInstantiateOrMigrateDataSource.type,
          data: {
            type: 'instantiate',
            address: 'juno1rbamC',
            codeId: 2001,
            codeIdsKeys: ['dao-rbam'],
          },
        },
      ])
    })
  })
})
