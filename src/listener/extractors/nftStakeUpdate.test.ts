import { Event } from '@cosmjs/stargate'
import { DecodedStargateMsg } from '@dao-dao/types'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { AutoCosmWasmClient } from '@/utils'

import { NftStakeUpdateExtractorData, nftStakeUpdate } from './nftStakeUpdate'

describe('NFT Stake Update Extractor', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let extractor: Awaited<ReturnType<typeof nftStakeUpdate>>

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    vi.spyOn(instance, 'findWasmCodeIdsByKeys').mockImplementation(
      (key: string) => {
        if (key === 'dao-voting-cw721-staked') {
          return [123, 456] // Mock code IDs for dao-voting-cw721-staked
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
        getHeight: vi.fn().mockResolvedValue(1001),
      },
    } as any

    // Set up the extractor
    extractor = await nftStakeUpdate({
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

    it('should match NFT stake update events', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1nftvoting123contract456' },
            { key: 'action', value: 'stake' },
            { key: 'from', value: 'juno1staker123' },
            { key: 'token_id', value: '123' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1nftvoting123contract456' },
            { key: 'action', value: 'unstake' },
            { key: 'from', value: 'juno1staker123' },
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
        updates: [
          {
            contractAddress: 'juno1nftvoting123contract456',
            staked: [{ from: 'juno1staker123', tokenId: '123' }],
            unstaked: [{ from: 'juno1staker123' }],
          },
        ],
      })
    })

    it('should not match non-NFT stake update events', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1other123contract456' },
            { key: 'action', value: 'some_other_action' },
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
    it('should extract NFT stake update information successfully', async () => {
      const data: NftStakeUpdateExtractorData = {
        updates: [
          {
            contractAddress: 'juno1nftvoting123contract456',
            staked: [{ from: 'juno1staker123', tokenId: '123' }],
            unstaked: [{ from: 'juno1staker123' }],
          },
        ],
      }

      // Mock the client methods
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockResolvedValue({
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

      const result = (await extractor.extract({
        txHash: 'test-hash-123',
        block: {
          height: '1000',
          timeUnixMs: '1640995200000',
          timestamp: '2022-01-01T01:00:00Z',
        },
        data,
      })) as Extraction[]

      expect(mockAutoCosmWasmClient.update).toHaveBeenCalled()
      expect(mockAutoCosmWasmClient.client!.getContract).toHaveBeenCalledWith(
        'juno1nftvoting123contract456'
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
          txHash: 'test-hash-123',
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
          txHash: 'test-hash-123',
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
          txHash: 'test-hash-123',
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
          txHash: 'test-hash-123',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should handle multiple NFT stake updates', async () => {
      const data: NftStakeUpdateExtractorData = {
        updates: [
          {
            contractAddress: 'juno1nftvoting123contract456',
            staked: [{ from: 'juno1staker123', tokenId: '123' }],
            unstaked: [],
          },
          {
            contractAddress: 'juno1nftvoting789contract012',
            staked: [],
            unstaked: [{ from: 'juno1staker456' }],
          },
        ],
      }

      // Mock additional contract calls
      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
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

      const result = (
        (await extractor.extract({
          txHash: 'test-hash-456',
          block: {
            height: '1000',
            timeUnixMs: '1640995200000',
            timestamp: '2022-01-01T01:00:00Z',
          },
          data,
        })) as Extraction[]
      ).sort((a, b) => a.name.localeCompare(b.name))

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
          txHash: 'test-hash-456',
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
          txHash: 'test-hash-456',
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
          txHash: 'test-hash-456',
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
          txHash: 'test-hash-456',
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
          txHash: 'test-hash-456',
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
          txHash: 'test-hash-456',
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
          txHash: 'test-hash-456',
          data: 'juno1staker456',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should handle contract query failures gracefully', async () => {
      const data: NftStakeUpdateExtractorData = {
        updates: [
          {
            contractAddress: 'juno1nftvoting123contract456',
            staked: [{ from: 'juno1staker123', tokenId: '123' }],
            unstaked: [],
          },
          {
            contractAddress: 'juno1nftvoting789contract012',
            staked: [{ from: 'juno1staker456', tokenId: '999' }],
            unstaked: [],
          },
        ],
      }

      // Mock one successful and one failing contract
      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
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

      const result = (await extractor.extract({
        txHash: 'test-hash-789',
        block: {
          height: '1000',
          timeUnixMs: '1640995200000',
          timestamp: '2022-01-01T01:00:00Z',
        },
        data,
      })) as Extraction[]

      // Should only have extraction for the successful contract
      expect(result.map((r) => r.toJSON())).toEqual([
        {
          id: '1',
          address: 'juno1nftvoting123contract456',
          name: 'total_power_at_height:1000',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash-789',
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
          txHash: 'test-hash-789',
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
          txHash: 'test-hash-789',
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
          txHash: 'test-hash-789',
          data: 'juno1staker123',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ])
    })

    it('should not extract if contract is not a dao-voting-cw721-staked contract', async () => {
      const data: NftStakeUpdateExtractorData = {
        updates: [
          {
            contractAddress: 'juno1nftvoting123contract456',
            staked: [{ from: 'juno1staker123', tokenId: '123' }],
            unstaked: [],
          },
          {
            contractAddress: 'juno1nftvoting789contract012',
            staked: [{ from: 'juno1staker456', tokenId: '999' }],
            unstaked: [],
          },
        ],
      }

      // Mock one correct code ID and one incorrect code ID
      vi.mocked(mockAutoCosmWasmClient.client!.getContract)
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
          }
        }
        // Will not be called because the code ID is incorrect.
        throw new Error('Unknown query')
      })

      const result = (await extractor.extract({
        txHash: 'test-hash-789',
        block: {
          height: '1000',
          timeUnixMs: '1640995200000',
          timestamp: '2022-01-01T01:00:00Z',
        },
        data,
      })) as Extraction[]

      // Should only have extraction for the correct code ID
      expect(result.map((r) => r.toJSON())).toEqual([
        {
          id: '1',
          address: 'juno1nftvoting123contract456',
          name: 'total_power_at_height:1000',
          blockHeight: '1000',
          blockTimeUnixMs: '1640995200000',
          txHash: 'test-hash-789',
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
          txHash: 'test-hash-789',
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
          txHash: 'test-hash-789',
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
          txHash: 'test-hash-789',
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

      const brokenExtractor = await nftStakeUpdate({
        config: ConfigManager.load(),
        sendWebhooks: false,
        autoCosmWasmClient: brokenAutoClient as any,
      })

      const data: NftStakeUpdateExtractorData = {
        updates: [
          {
            contractAddress: 'juno1nftvoting123contract456',
            staked: [{ from: 'juno1staker123', tokenId: '123' }],
            unstaked: [],
          },
        ],
      }

      await expect(
        brokenExtractor.extract({
          txHash: 'test-hash-error',
          block: {
            height: '1000',
            timeUnixMs: '1640995200000',
            timestamp: '2022-01-01T01:00:00Z',
          },
          data,
        })
      ).rejects.toThrow('CosmWasm client not connected')
    })
  })
})
