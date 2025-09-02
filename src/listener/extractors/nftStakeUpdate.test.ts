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
import { Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'
import * as utils from '@/utils'

import { WasmEventDataSource } from '../sources'
import { NftStakeUpdateExtractor } from './nftStakeUpdate'

describe('NFT Stake Update Extractor', () => {
  let mockAutoCosmWasmClient: utils.AutoCosmWasmClient
  let extractor: NftStakeUpdateExtractor
  let getContractMock: MockInstance

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    vi.spyOn(instance, 'findWasmCodeIdsByKeys').mockImplementation(
      (...keys: string[]) => {
        if (keys.includes('dao-voting-cw721-staked')) {
          return [123, 456] // Mocked code IDs
        }
        return []
      }
    )
  })

  beforeEach(async () => {
    vi.clearAllMocks()

    getContractMock = vi.spyOn(utils, 'getContractInfo')

    // Create mock AutoCosmWasmClient
    mockAutoCosmWasmClient = {
      update: vi.fn(),
      client: {
        queryContractSmart: vi.fn(),
        getBlock: vi.fn(),
        getHeight: vi.fn().mockResolvedValue(1001),
      },
    } as any

    // Set up the extractor environment
    const env: ExtractorEnv = {
      config: ConfigManager.load(),
      sendWebhooks: false,
      autoCosmWasmClient: mockAutoCosmWasmClient as any,
      txHash: 'test-hash',
      block: {
        height: '1000',
        timeUnixMs: '1640995200000',
        timestamp: '2022-01-01T01:00:00Z',
      },
    }

    extractor = new NftStakeUpdateExtractor(env)
  })

  describe('data sources configuration', () => {
    it('should have correct data sources configured', () => {
      expect(extractor.sources).toHaveLength(2)

      const stakeSource = extractor.sources.find((s) => s.handler === 'stake')
      expect(stakeSource).toBeDefined()
      expect(stakeSource!.type).toBe(WasmEventDataSource.type)
      expect(stakeSource!.config).toEqual({
        key: 'action',
        value: 'stake',
        otherAttributes: ['from', 'token_id'],
      })

      const unstakeSource = extractor.sources.find(
        (s) => s.handler === 'unstake'
      )
      expect(unstakeSource).toBeDefined()
      expect(unstakeSource!.type).toBe(WasmEventDataSource.type)
      expect(unstakeSource!.config).toEqual({
        key: 'action',
        value: 'unstake',
        otherAttributes: ['from'],
      })
    })

    it('should have correct static type', () => {
      expect(NftStakeUpdateExtractor.type).toBe('nftStakeUpdate')
    })
  })

  describe('extract function', () => {
    it('should extract NFT stake update information successfully', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('stake', {
          address: 'juno1nftvoting123contract456',
          key: 'action',
          value: 'stake',
          attributes: {
            action: ['stake'],
            from: ['juno1staker123'],
            token_id: ['123'],
          },
          _attributes: [
            { key: '_contract_address', value: 'juno1nftvoting123contract456' },
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker123' },
            { key: 'token_id', value: '123' },
          ],
        }),
      ]

      // Mock the client methods
      getContractMock.mockResolvedValue({
        address: 'juno1nftvoting123contract456',
        codeId: 123,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test DAO',
        ibcPortId: 'juno1ibc123',
      })

      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, queryMsg: any) => {
        if (address === 'juno1nftvoting123contract456') {
          if (queryMsg.total_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.voting_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.staked_nfts) {
            return ['123', '789']
          }
        }

        throw new Error('Unknown query')
      })

      const result = (await extractor.extract(data)) as Extraction[]

      expect(getContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'juno1nftvoting123contract456',
        })
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(3)
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1nftvoting123contract456', {
        total_power_at_height: {},
      })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1nftvoting123contract456', {
        voting_power_at_height: {
          address: 'juno1staker123',
        },
      })
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1nftvoting123contract456', {
        staked_nfts: {
          address: 'juno1staker123',
          start_after: undefined,
          limit: 30,
        },
      })

      expect(result.map((r) => r.toJSON())).toEqual([
        {
          id: '1',
          address: 'juno1nftvoting123contract456',
          name: 'total_power_at_height:1000',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: '200',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '2',
          address: 'juno1nftvoting123contract456',
          name: 'staker:juno1staker123',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: {
            votingPower: '200',
            stakedTokenIds: ['123', '789'],
          },
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '3',
          address: 'juno1nftvoting123contract456',
          name: 'stakedNftOwner:123',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '4',
          address: 'juno1nftvoting123contract456',
          name: 'stakedNftOwner:789',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should handle multiple NFT stake updates', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('stake', {
          address: 'juno1nftvoting123contract456',
          key: 'action',
          value: 'stake',
          attributes: {
            action: ['stake'],
            from: ['juno1staker123'],
            token_id: ['123'],
          },
          _attributes: [
            { key: '_contract_address', value: 'juno1nftvoting123contract456' },
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker123' },
            { key: 'token_id', value: '123' },
          ],
        }),
        WasmEventDataSource.handleable('unstake', {
          address: 'juno1nftvoting789contract012',
          key: 'action',
          value: 'unstake',
          attributes: {
            action: ['unstake'],
            from: ['juno1staker456'],
          },
          _attributes: [
            { key: '_contract_address', value: 'juno1nftvoting789contract012' },
            { key: 'action', value: 'unstake' },
            { key: 'from', value: 'juno1staker456' },
          ],
        }),
      ]

      // Mock additional contract calls
      getContractMock
        .mockResolvedValueOnce({
          address: 'juno1nftvoting123contract456',
          codeId: 123,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test NFT Voting 1',
          ibcPortId: 'juno1ibc123',
        })
        .mockResolvedValueOnce({
          address: 'juno1nftvoting789contract012',
          codeId: 456,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test NFT Voting 2',
          ibcPortId: 'juno1ibc456',
        })

      // Mock query calls for both contracts
      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, queryMsg: any) => {
        if (address === 'juno1nftvoting123contract456') {
          if (queryMsg.total_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.voting_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.staked_nfts) {
            return ['123', '789']
          }
        } else if (address === 'juno1nftvoting789contract012') {
          if (queryMsg.total_power_at_height) {
            return {
              power: '100',
              height: 1000,
            }
          } else if (queryMsg.voting_power_at_height) {
            return {
              power: '100',
            }
          } else if (queryMsg.staked_nfts) {
            return ['999']
          }
        }
        throw new Error('Unknown query')
      })

      const result = ((await extractor.extract(data)) as Extraction[]).sort(
        (a, b) => a.name.localeCompare(b.name)
      )

      expect(
        result
          .map((r) => r.toJSON())
          .sort(
            (a, b) =>
              a.address.localeCompare(b.address) ||
              -a.name.localeCompare(b.name)
          )
      ).toEqual([
        {
          id: expect.any(String),
          address: 'juno1nftvoting123contract456',
          name: 'total_power_at_height:1000',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: '200',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: expect.any(String),
          address: 'juno1nftvoting123contract456',
          name: 'staker:juno1staker123',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: {
            votingPower: '200',
            stakedTokenIds: ['123', '789'],
          },
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: expect.any(String),
          address: 'juno1nftvoting123contract456',
          name: 'stakedNftOwner:789',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: expect.any(String),
          address: 'juno1nftvoting123contract456',
          name: 'stakedNftOwner:123',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: expect.any(String),
          address: 'juno1nftvoting789contract012',
          name: 'total_power_at_height:1000',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: '100',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: expect.any(String),
          address: 'juno1nftvoting789contract012',
          name: 'staker:juno1staker456',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: {
            votingPower: '100',
            stakedTokenIds: ['999'],
          },
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: expect.any(String),
          address: 'juno1nftvoting789contract012',
          name: 'stakedNftOwner:999',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: 'juno1staker456',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should throw error on contract query failure', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('stake', {
          address: 'juno1nftvoting123contract456',
          key: 'action',
          value: 'stake',
          attributes: {
            action: ['stake'],
            from: ['juno1staker123'],
            token_id: ['123'],
          },
          _attributes: [
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker123' },
            { key: 'token_id', value: '123' },
          ],
        }),
        WasmEventDataSource.handleable('stake', {
          address: 'juno1nftvoting789contract012',
          key: 'action',
          value: 'stake',
          attributes: {
            action: ['stake'],
            from: ['juno1staker456'],
            token_id: ['999'],
          },
          _attributes: [
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker456' },
            { key: 'token_id', value: '999' },
          ],
        }),
      ]

      // Mock one successful and one failing contract
      getContractMock
        .mockResolvedValueOnce({
          address: 'juno1nftvoting123contract456',
          codeId: 123,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test NFT Voting 1',
          ibcPortId: undefined,
        })
        .mockResolvedValueOnce({
          address: 'juno1nftvoting789contract012',
          codeId: 456,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test NFT Voting 2',
          ibcPortId: undefined,
        })

      // Mock successful queries for first contract, failed for second
      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, queryMsg: any) => {
        // First contract
        if (address === 'juno1nftvoting123contract456') {
          if (queryMsg.total_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.voting_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.staked_nfts) {
            return ['123', '789']
          } else {
            throw new Error('Unknown query')
          }
        }
        // Second contract
        throw new Error('Query failed')
      })

      await expect(extractor.extract(data)).rejects.toThrow('Query failed')
    })

    it('should not extract if contract is not a dao-voting-cw721-staked contract', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('stake', {
          address: 'juno1nftvoting123contract456',
          key: 'action',
          value: 'stake',
          attributes: {
            action: ['stake'],
            from: ['juno1staker123'],
            token_id: ['123'],
          },
          _attributes: [
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker123' },
            { key: 'token_id', value: '123' },
          ],
        }),
        WasmEventDataSource.handleable('stake', {
          address: 'juno1nftvoting789contract012',
          key: 'action',
          value: 'stake',
          attributes: {
            action: ['stake'],
            from: ['juno1staker456'],
            token_id: ['999'],
          },
          _attributes: [
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker456' },
            { key: 'token_id', value: '999' },
          ],
        }),
      ]

      // Mock one correct code ID and one incorrect code ID
      getContractMock
        .mockResolvedValueOnce({
          address: 'juno1nftvoting123contract456',
          codeId: 123,
          admin: 'juno1admin123',
          creator: 'juno1creator123',
          label: 'Test NFT Voting 1',
          ibcPortId: undefined,
        })
        .mockResolvedValueOnce({
          address: 'juno1nftvoting789contract012',
          codeId: 9999,
          admin: 'juno1admin456',
          creator: 'juno1creator456',
          label: 'Test NFT Voting 2',
          ibcPortId: undefined,
        })

      // Mock successful queries for first contract only
      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, queryMsg: any) => {
        // First contract
        if (address === 'juno1nftvoting123contract456') {
          if (queryMsg.total_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.voting_power_at_height) {
            return {
              power: '200',
              height: 1000,
            }
          } else if (queryMsg.staked_nfts) {
            return ['123', '789']
          }
        }
        // Will not be called because the code ID is incorrect.
        throw new Error('Unknown query')
      })

      const result = (await extractor.extract(data)) as Extraction[]

      // Should only have extraction for the correct code ID
      expect(result.map((r) => r.toJSON())).toEqual([
        {
          id: '1',
          address: 'juno1nftvoting123contract456',
          name: 'total_power_at_height:1000',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: '200',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '2',
          address: 'juno1nftvoting123contract456',
          name: 'staker:juno1staker123',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: {
            votingPower: '200',
            stakedTokenIds: ['123', '789'],
          },
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '3',
          address: 'juno1nftvoting123contract456',
          name: 'stakedNftOwner:123',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: '4',
          address: 'juno1nftvoting123contract456',
          name: 'stakedNftOwner:789',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
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

      const brokenExtractor = new NftStakeUpdateExtractor(brokenEnv)

      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('stake', {
          address: 'juno1nftvoting123contract456',
          key: 'action',
          value: 'stake',
          attributes: {
            action: ['stake'],
            from: ['juno1staker123'],
            token_id: ['123'],
          },
          _attributes: [
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker123' },
            { key: 'token_id', value: '123' },
          ],
        }),
      ]

      await expect(brokenExtractor.extract(data)).rejects.toThrow(
        'CosmWasm client not connected'
      )
    })
  })
})
