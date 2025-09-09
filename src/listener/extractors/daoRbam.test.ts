import { Event } from '@cosmjs/stargate'
import { DecodedStargateMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Block, Contract, Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { AutoCosmWasmClient } from '@/utils'

import { DaoRbamExtractorData, daoRbam } from './daoRbam'

describe('DAO RBAM Extractor', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let extractor: Awaited<ReturnType<typeof daoRbam>>

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    vi.spyOn(instance, 'findWasmCodeIdsByKeys').mockImplementation(
      (key: string) => {
        if (key === 'dao-rbam') {
          return [9999, 2001] // Mock code IDs for dao-rbam
        }
        return []
      }
    )
  })

  beforeEach(async () => {
    mockAutoCosmWasmClient = {
      update: vi.fn(),
      client: {
        getContract: vi.fn(),
        queryContractSmart: vi.fn(),
        getBlock: vi.fn(),
        getHeight: vi.fn(),
      },
    } as any

    extractor = await daoRbam({
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

    it('matches RBAM instantiation events', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '9999' },
            { key: '_contract_address', value: 'juno1rbamcontract1' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'hash-1',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toEqual({ addresses: ['juno1rbamcontract1'] })
    })

    it('matches multiple RBAM instantiations', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '9999' },
            { key: '_contract_address', value: 'juno1rbamcontract1' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '2001' },
            { key: '_contract_address', value: 'juno1rbamcontract2' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'hash-2',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toEqual({
        addresses: ['juno1rbamcontract1', 'juno1rbamcontract2'],
      })
    })

    it('does not match non-RBAM code IDs', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '4862' },
            { key: '_contract_address', value: 'juno1other' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'hash-3',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toBeUndefined()
    })

    it('matches RBAM executions: create_role, update_role, assign, revoke', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'create_role' },
            { key: '_contract_address', value: 'juno1rbamcontract1' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'update_role' },
            { key: '_contract_address', value: 'juno1rbamcontract2' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'assign' },
            { key: '_contract_address', value: 'juno1rbamcontract3' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'revoke' },
            { key: '_contract_address', value: 'juno1rbamcontract4' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'hash-4',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toEqual({
        addresses: [
          'juno1rbamcontract1',
          'juno1rbamcontract2',
          'juno1rbamcontract3',
          'juno1rbamcontract4',
        ],
      })
    })

    it('combines instantiation and execution addresses', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '9999' },
            { key: '_contract_address', value: 'juno1rbamcontract1' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'assign' },
            { key: '_contract_address', value: 'juno1rbamcontract2' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'hash-5',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toEqual({
        addresses: ['juno1rbamcontract1', 'juno1rbamcontract2'],
      })
    })

    it('returns undefined when no matching events', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'something_else' },
            { key: '_contract_address', value: 'juno1x' },
          ],
        },
      ]

      const result = extractor.match({
        hash: 'hash-6',
        tx: createMockTx(),
        messages: createMockMessages(),
        events,
      })

      expect(result).toBeUndefined()
    })
  })

  describe('extract function', () => {
    const mockContractInfo = {
      info: { contract: 'crates.io:dao-rbam', version: '1.0.0' },
    }
    const mockDao = { dao: 'juno1daoaddress' }
    const mockAssignments = {
      assignments: [{ addr: 'juno1user', role_id: 1 }],
    }
    const mockRoles = { roles: [{ id: 1, name: 'Administrator' }] }

    beforeEach(async () => {
      await Block.createOne({
        height: 1000,
        timeUnixMs: 1640995200000, // 2022-01-01T00:00:00Z
      })

      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockResolvedValue({
        address: 'juno1rbamcontract1',
        codeId: 9999,
        admin: 'juno1admin',
        creator: 'juno1creator',
        label: 'RBAM Contract 1',
        ibcPortId: undefined,
      })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // info
        .mockResolvedValueOnce(mockDao) // dao
        .mockResolvedValueOnce(mockAssignments) // list_assignments
        .mockResolvedValueOnce(mockRoles) // list_roles
    })

    it('extracts RBAM contract data successfully', async () => {
      const data: DaoRbamExtractorData = {
        addresses: ['juno1rbamcontract1'],
      }

      const result = (await extractor.extract({
        txHash: 'hash-extract-1',
        height: '1000',
        data,
      })) as Extraction[]

      expect(mockAutoCosmWasmClient.update).toHaveBeenCalled()
      expect(mockAutoCosmWasmClient.client!.getContract).toHaveBeenCalledWith(
        'juno1rbamcontract1'
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(4)
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenNthCalledWith(1, 'juno1rbamcontract1', { info: {} })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenNthCalledWith(2, 'juno1rbamcontract1', { dao: {} })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenNthCalledWith(3, 'juno1rbamcontract1', {
        list_assignments: {},
      })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenNthCalledWith(4, 'juno1rbamcontract1', { list_roles: {} })

      expect(result).toHaveLength(4)

      const names = result.map((r) => r.name).sort()
      expect(names).toEqual(
        [
          'dao-rbam/dao',
          'dao-rbam/info',
          'dao-rbam/list_assignments',
          'dao-rbam/list_roles',
        ].sort()
      )

      for (const r of result) {
        expect(r.address).toBe('juno1rbamcontract1')
        expect(r.blockHeight).toBe('1000')
        expect(r.txHash).toBe('hash-extract-1')
      }
    })

    it('handles multiple RBAM addresses', async () => {
      const data: DaoRbamExtractorData = {
        addresses: ['juno1rbamcontract1', 'juno1rbamcontract2'],
      }

      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
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
          codeId: 9999,
          admin: 'juno1admin2',
          creator: 'juno1creator2',
          label: 'RBAM Contract 2',
          ibcPortId: undefined,
        })

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        // contract 1
        .mockResolvedValueOnce(mockContractInfo)
        .mockResolvedValueOnce(mockDao)
        .mockResolvedValueOnce(mockAssignments)
        .mockResolvedValueOnce(mockRoles)
        // contract 2
        .mockResolvedValueOnce(mockContractInfo)
        .mockResolvedValueOnce(mockDao)
        .mockResolvedValueOnce(mockAssignments)
        .mockResolvedValueOnce(mockRoles)

      const result = (await extractor.extract({
        txHash: 'hash-extract-2',
        height: '1000',
        data,
      })) as Extraction[]

      expect(result).toHaveLength(8) // 4 per contract
      const addresses = result.map((r) => r.address)
      expect(addresses).toContain('juno1rbamcontract1')
      expect(addresses).toContain('juno1rbamcontract2')
    })

    it('handles query failures gracefully (partial success)', async () => {
      const data: DaoRbamExtractorData = {
        addresses: ['juno1rbamcontract1', 'juno1rbamcontract2'],
      }

      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
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
          codeId: 9999,
          admin: 'juno1admin2',
          creator: 'juno1creator2',
          label: 'RBAM Contract 2',
          ibcPortId: undefined,
        })

      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, queryMsg: any) => {
        if (address === 'juno1rbamcontract1') {
          if (queryMsg.info) return mockContractInfo
          if (queryMsg.dao) return mockDao
          if (queryMsg.list_assignments) return mockAssignments
          if (queryMsg.list_roles) return mockRoles
          throw new Error('Unknown query')
        }
        // Fail all queries for contract 2
        throw new Error('Query failed')
      })

      const result = (await extractor.extract({
        txHash: 'hash-extract-3',
        height: '1000',
        data,
      })) as Extraction[]

      // Only the first contract should produce 4 extractions
      expect(result.map((r) => r.toJSON())).toEqual([
        {
          id: '1',
          address: 'juno1rbamcontract1',
          name: 'dao-rbam/info',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'hash-extract-3',
          data: mockContractInfo,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '2',
          address: 'juno1rbamcontract1',
          name: 'dao-rbam/dao',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'hash-extract-3',
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
          txHash: 'hash-extract-3',
          data: mockAssignments,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '4',
          address: 'juno1rbamcontract1',
          name: 'dao-rbam/list_roles',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'hash-extract-3',
          data: mockRoles,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('gets block time from RPC when not in DB', async () => {
      const data: DaoRbamExtractorData = {
        addresses: ['juno1rbamcontract1'],
      }

      vi.mocked(mockAutoCosmWasmClient.client!.getBlock).mockResolvedValue({
        header: { time: '2022-01-01T01:23:45Z' },
      } as any)

      // set up queries again because beforeEach consumed them
      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo)
        .mockResolvedValueOnce(mockDao)
        .mockResolvedValueOnce(mockAssignments)
        .mockResolvedValueOnce(mockRoles)

      const result = (await extractor.extract({
        txHash: 'hash-extract-rpc',
        height: '2000',
        data,
      })) as Extraction[]

      expect(mockAutoCosmWasmClient.client!.getBlock).toHaveBeenCalledWith(2000)
      expect(result).toHaveLength(4)
      for (const r of result) {
        expect(r.blockTimeUnixMs).toBe(
          Date.parse('2022-01-01T01:23:45Z').toString()
        )
      }
    })

    it('creates/updates Contract row with correct info', async () => {
      const data: DaoRbamExtractorData = {
        addresses: ['juno1rbamcontract1'],
      }

      await extractor.extract({
        txHash: 'hash-extract-contract',
        height: '1000',
        data,
      })

      const contract = await Contract.findByPk('juno1rbamcontract1')
      expect(contract).toBeDefined()
      expect(contract!.codeId).toBe(9999)
      expect(contract!.admin).toBe('juno1admin')
      expect(contract!.creator).toBe('juno1creator')
      expect(contract!.label).toBe('RBAM Contract 1')
      expect(contract!.instantiatedAtBlockHeight).toBe('1000')
      expect(contract!.instantiatedAtBlockTimeUnixMs).toBe('1640995200000')
    })

    it('throws when client is not connected', async () => {
      const brokenAutoClient = {
        ...mockAutoCosmWasmClient,
        client: undefined,
      }

      const brokenExtractor = await daoRbam({
        config: ConfigManager.load(),
        sendWebhooks: false,
        autoCosmWasmClient: brokenAutoClient as any,
      })

      const data: DaoRbamExtractorData = {
        addresses: ['juno1rbamcontract1'],
      }

      await expect(
        brokenExtractor.extract({
          txHash: 'hash-fail',
          height: '1000',
          data,
        })
      ).rejects.toThrow('CosmWasm client not connected')
    })
  })
})
