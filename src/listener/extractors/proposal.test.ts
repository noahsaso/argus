import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Contract, Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'
import { AutoCosmWasmClient } from '@/utils'

import { WasmEventData, WasmEventDataSource } from '../sources'
import { ProposalExtractor } from './proposal'

describe('Proposal Extractor', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let extractor: ProposalExtractor

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    vi.spyOn(instance, 'findWasmCodeIdsByKeys').mockImplementation(
      (...keys: string[]) => {
        if (
          keys.includes('dao-proposal-single') ||
          keys.includes('dao-proposal-multiple')
        ) {
          return [4863, 4864] // Mocked code IDs for proposal contracts
        }
        return []
      }
    )
    vi.spyOn(instance, 'matchesWasmCodeKeys').mockImplementation(
      (codeId: number, ...keys: string[]) => {
        if (
          keys.includes('dao-proposal-single') ||
          keys.includes('dao-proposal-multiple')
        ) {
          return [4863, 4864].includes(codeId)
        }
        return false
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
      txHash: 'test-proposal-hash',
      block: {
        height: '1500',
        timeUnixMs: '1640995200000',
        timestamp: '2022-01-01T01:00:00Z',
      },
    }

    extractor = new ProposalExtractor(env)
  })

  describe('data sources configuration', () => {
    it('should have correct data sources configured', () => {
      expect(extractor.sources).toHaveLength(2)

      const proposalActionSource = extractor.sources.find(
        (s) =>
          s.type === WasmEventDataSource.type &&
          Array.isArray(s.config.value) &&
          s.config.value.includes('propose')
      )
      expect(proposalActionSource).toBeDefined()
      expect(proposalActionSource!.handler).toBe('execute')
      expect(proposalActionSource!.config).toEqual({
        key: 'action',
        value: ['propose', 'execute', 'vote', 'close'],
        otherAttributes: ['sender', 'proposal_id'],
      })

      const vetoSource = extractor.sources.find(
        (s) => s.type === WasmEventDataSource.type && s.config.value === 'veto'
      )
      expect(vetoSource).toBeDefined()
      expect(vetoSource!.handler).toBe('execute')
      expect(vetoSource!.config).toEqual({
        key: 'action',
        value: 'veto',
        otherAttributes: ['proposal_id'],
      })
    })

    it('should have correct static type', () => {
      expect(ProposalExtractor.type).toBe('proposal')
    })
  })

  describe('extract function', () => {
    const mockContractInfo = {
      info: {
        contract: 'crates.io:dao-proposal-single',
        version: '2.4.0',
      },
    }

    const mockProposal = {
      id: 1,
      title: 'Test Proposal',
      description: 'A test proposal for testing',
      status: 'open',
      proposer: 'juno1proposer123',
      veto: {
        vetoer: 'juno1vetoer123',
      },
    }

    const mockVote = {
      vote: 'yes',
      voter: 'juno1voter123',
      power: '1000000',
    }

    beforeEach(() => {
      // Default mock for contract info
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockResolvedValue({
        address: 'juno1proposal123contract456',
        codeId: 4863,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test Proposal Contract',
        ibcPortId: 'juno1ibc123',
      })
    })

    it('should extract proposal information successfully from propose action', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'propose',
          attributes: {
            action: ['propose'],
            proposal_id: ['1'],
            sender: ['juno1proposer123'],
          },
          _attributes: [
            { key: 'action', value: 'propose' },
            { key: 'proposal_id', value: '1' },
            { key: 'sender', value: 'juno1proposer123' },
          ],
        }),
      ]

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // info query
        .mockResolvedValueOnce({ proposal: mockProposal }) // proposal query

      const result = (await extractor.extract(data)) as Extraction[]

      expect(mockAutoCosmWasmClient.client!.getContract).toHaveBeenCalledWith(
        'juno1proposal123contract456'
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(2)

      expect(result).toHaveLength(2) // proposal + vetoer mapping

      // Check proposal extraction
      const proposalExtraction = result.find((e) => e.name === 'proposal:1')
      expect(proposalExtraction).toBeDefined()
      expect(proposalExtraction!.address).toBe('juno1proposal123contract456')
      expect(proposalExtraction!.data).toEqual(mockProposal)

      // Check vetoer mapping (only created when proposing and vetoer exists)
      const vetoerExtraction = result.find(
        (e) => e.name === 'proposalVetoer:juno1vetoer123:1'
      )
      expect(vetoerExtraction).toBeDefined()
      expect(vetoerExtraction!.address).toBe('juno1proposal123contract456')
      expect(vetoerExtraction!.data).toBe(1)
    })

    it('should extract vote information when vote is cast', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'vote',
          attributes: {
            action: ['vote'],
            proposal_id: ['1'],
            sender: ['juno1voter123'],
            position: ['yes'],
          },
          _attributes: [
            { key: 'action', value: 'vote' },
            { key: 'proposal_id', value: '1' },
            { key: 'sender', value: 'juno1voter123' },
            { key: 'position', value: 'yes' },
          ],
        }),
      ]

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // info query
        .mockResolvedValueOnce({ proposal: mockProposal }) // proposal query
        .mockResolvedValueOnce({ vote: mockVote }) // vote query

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(2) // proposal + vote

      // Check proposal extraction
      const proposalExtraction = result.find((e) => e.name === 'proposal:1')
      expect(proposalExtraction).toBeDefined()
      expect(proposalExtraction!.data).toEqual(mockProposal)

      // Check vote extraction
      const voteExtraction = result.find(
        (e) => e.name === 'voteCast:juno1voter123:1'
      )
      expect(voteExtraction).toBeDefined()
      expect(voteExtraction!.address).toBe('juno1proposal123contract456')
      expect(voteExtraction!.data).toEqual(mockVote)
    })

    it('should handle veto action without sender', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'veto',
          attributes: {
            action: ['veto'],
            proposal_id: ['1'],
          },
          _attributes: [
            { key: 'action', value: 'veto' },
            { key: 'proposal_id', value: '1' },
          ],
        }),
      ]

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // info query
        .mockResolvedValueOnce({ proposal: mockProposal }) // proposal query
        .mockResolvedValueOnce({ vote: null }) // vote query (no vote cast)

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(1) // only proposal, no vote or vetoer mapping

      const proposalExtraction = result.find((e) => e.name === 'proposal:1')
      expect(proposalExtraction).toBeDefined()
      expect(proposalExtraction!.data).toEqual(mockProposal)
    })

    it('should handle vote query for v1 contract version', async () => {
      const oldVersionInfo = {
        info: {
          contract: 'crates.io:dao-proposal-single',
          version: '0.1.0',
        },
      }

      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'vote',
          attributes: {
            action: ['vote'],
            proposal_id: ['1'],
            sender: ['juno1voter123'],
            position: ['yes'],
          },
          _attributes: [
            { key: 'action', value: 'vote' },
            { key: 'proposal_id', value: '1' },
            { key: 'sender', value: 'juno1voter123' },
            { key: 'position', value: 'yes' },
          ],
        }),
      ]

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(oldVersionInfo) // info query
        .mockResolvedValueOnce({ proposal: mockProposal }) // proposal query
        .mockResolvedValueOnce({ vote: mockVote }) // vote query with old version

      const result = (await extractor.extract(data)) as Extraction[]

      // Verify that the old version vote query was called
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1proposal123contract456', {
        vote: {
          proposal_id: 1,
          voter: 'juno1voter123',
        },
      })

      expect(result).toHaveLength(2) // proposal + vote
    })

    it('should handle vote query for v2 contract version', async () => {
      const newVersionInfo = {
        info: {
          contract: 'crates.io:dao-proposal-single',
          version: '2.4.0',
        },
      }

      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'vote',
          attributes: {
            action: ['vote'],
            proposal_id: ['1'],
            sender: ['juno1voter123'],
            position: ['yes'],
          },
          _attributes: [
            { key: 'action', value: 'vote' },
            { key: 'proposal_id', value: '1' },
            { key: 'sender', value: 'juno1voter123' },
            { key: 'position', value: 'yes' },
          ],
        }),
      ]

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(newVersionInfo) // info query
        .mockResolvedValueOnce({ proposal: mockProposal }) // proposal query
        .mockResolvedValueOnce({ vote: mockVote }) // vote query with new version

      const result = (await extractor.extract(data)) as Extraction[]

      // Verify that the new version vote query was called
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledWith('juno1proposal123contract456', {
        get_vote: {
          proposal_id: 1,
          voter: 'juno1voter123',
        },
      })

      expect(result).toHaveLength(2) // proposal + vote
    })

    it('should not extract if contract is not a proposal contract', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1other123contract456',
          key: 'action',
          value: 'propose',
          attributes: {
            action: ['propose'],
            proposal_id: ['1'],
            sender: ['juno1proposer123'],
          },
          _attributes: [
            { key: 'action', value: 'propose' },
            { key: 'proposal_id', value: '1' },
            { key: 'sender', value: 'juno1proposer123' },
          ],
        }),
      ]

      // Mock non-proposal contract
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockResolvedValue({
        address: 'juno1other123contract456',
        codeId: 9999, // Different code ID
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Other Contract',
        ibcPortId: 'juno1ibc123',
      })

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(0)
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).not.toHaveBeenCalled()
    })

    it('should create contracts in database with correct information', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'propose',
          attributes: {
            action: ['propose'],
            proposal_id: ['1'],
            sender: ['juno1proposer123'],
          },
          _attributes: [
            { key: 'action', value: 'propose' },
            { key: 'proposal_id', value: '1' },
            { key: 'sender', value: 'juno1proposer123' },
          ],
        }),
      ]

      vi.mocked(mockAutoCosmWasmClient.client!.queryContractSmart)
        .mockResolvedValueOnce(mockContractInfo) // info query
        .mockResolvedValueOnce({ proposal: mockProposal }) // proposal query
        .mockResolvedValueOnce({ vote: null }) // vote query

      await extractor.extract(data)

      // Check that contract was created in database
      const contract = await Contract.findByPk('juno1proposal123contract456')
      expect(contract).toBeDefined()
      expect(contract!.codeId).toBe(4863)
      expect(contract!.admin).toBe('juno1admin123')
      expect(contract!.creator).toBe('juno1creator123')
      expect(contract!.label).toBe('Test Proposal Contract')
      expect(contract!.instantiatedAtBlockHeight).toBe('1500')
      expect(contract!.instantiatedAtBlockTimeUnixMs).toBe('1640995200000')
    })

    it('should throw error when proposal_id is missing', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'propose',
          attributes: {
            action: ['propose'],
            sender: ['juno1proposer123'],
          },
          _attributes: [
            { key: 'action', value: 'propose' },
            { key: 'sender', value: 'juno1proposer123' },
          ],
        }),
      ]

      await expect(extractor.extract(data)).rejects.toThrow(
        'missing `proposalId`'
      )
    })

    it('should throw error when proposal_id is invalid', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'propose',
          attributes: {
            action: ['propose'],
            proposal_id: ['invalid'],
            sender: ['juno1proposer123'],
          },
          _attributes: [
            { key: 'action', value: 'propose' },
            { key: 'proposal_id', value: 'invalid' },
            { key: 'sender', value: 'juno1proposer123' },
          ],
        }),
      ]

      await expect(extractor.extract(data)).rejects.toThrow(
        'missing `proposalId`'
      )
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
          height: '1500',
          timeUnixMs: '1640995200000',
          timestamp: '2022-01-01T01:00:00Z',
        },
      }

      const brokenExtractor = new ProposalExtractor(brokenEnv)

      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('execute', {
          address: 'juno1proposal123contract456',
          key: 'action',
          value: 'propose',
          attributes: {
            action: ['propose'],
            proposal_id: ['1'],
            sender: ['juno1proposer123'],
          },
          _attributes: [
            { key: 'action', value: 'propose' },
            { key: 'proposal_id', value: '1' },
            { key: 'sender', value: 'juno1proposer123' },
          ],
        }),
      ]

      await expect(brokenExtractor.extract(data)).rejects.toThrow(
        'CosmWasm client not connected'
      )
    })
  })

  describe('sync function', () => {
    it('should sync proposal and vote data for all contracts', async () => {
      // Mock contracts for both proposal contract types
      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 4863) {
            return ['juno1proposal123contract456']
          } else if (codeId === 4864) {
            return ['juno1proposal789contract012']
          } else {
            return []
          }
        }
      )

      // Mock proposal list queries
      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, query: any) => {
        if (query.list_proposals) {
          // Return mock proposals for different contracts
          if (address === 'juno1proposal123contract456') {
            return {
              proposals: [{ id: 1 }, { id: 2 }],
            }
          } else if (address === 'juno1proposal789contract012') {
            return {
              proposals: [{ id: 1 }],
            }
          }
        } else if (query.list_votes) {
          // Return mock votes
          return {
            votes: [{ voter: 'juno1voter123' }, { voter: 'juno1voter456' }],
          }
        }
        return {}
      })

      const result = await ProposalExtractor.sync!({
        config: extractor.env.config,
        autoCosmWasmClient: extractor.env.autoCosmWasmClient,
      })

      // Should return handleable data for:
      // - 2 proposals from first contract + 2 votes each = 6 items
      // - 1 proposal from second contract + 2 votes = 3 items
      // Total: 9 items
      expect(result).toHaveLength(9)

      // Check structure of returned data
      const proposalHandleables = result.filter((r) => {
        const data = r.data as WasmEventData
        return data.attributes.action?.[0] === 'propose'
      })
      const voteHandleables = result.filter((r) => {
        const data = r.data as WasmEventData
        return data.attributes.action?.[0] === 'vote'
      })

      expect(proposalHandleables).toHaveLength(3) // 3 proposals total
      expect(voteHandleables).toHaveLength(6) // 6 votes total

      // Check specific proposal handleable
      const firstProposal = proposalHandleables.find((r) => {
        const data = r.data as WasmEventData
        return (
          data.address === 'juno1proposal123contract456' &&
          data.attributes.proposal_id?.[0] === '1'
        )
      })
      expect(firstProposal).toBeDefined()
      const firstProposalData = firstProposal!.data as WasmEventData
      expect(firstProposalData.attributes.action).toEqual(['propose'])

      // Check specific vote handleable
      const firstVote = voteHandleables.find((r) => {
        const data = r.data as WasmEventData
        return (
          data.address === 'juno1proposal123contract456' &&
          data.attributes.sender?.[0] === 'juno1voter123'
        )
      })
      expect(firstVote).toBeDefined()
      const firstVoteData = firstVote!.data as WasmEventData
      expect(firstVoteData.attributes.action).toEqual(['vote'])
      expect(firstVoteData.attributes.position).toEqual(['placeholder'])
    })

    it('should handle pagination in sync function', async () => {
      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 4863) {
            return ['juno1proposal123contract456']
          } else {
            return [] // Return empty for other code IDs
          }
        }
      )

      let proposalCallCount = 0
      let voteCallCount = 0

      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, query: any) => {
        if (query.list_proposals) {
          proposalCallCount++
          if (proposalCallCount === 1) {
            // First page: return 30 proposals to trigger pagination
            return {
              proposals: Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })),
            }
          } else {
            // Second page: return fewer than 30 to stop pagination
            return {
              proposals: [{ id: 31 }],
            }
          }
        } else if (query.list_votes) {
          voteCallCount++
          if (voteCallCount <= 31) {
            // First call for each proposal: return 30 votes to trigger pagination
            return {
              votes: Array.from({ length: 30 }, (_, i) => ({
                voter: `juno1voter${i + 1}`,
              })),
            }
          } else {
            // Second call for each proposal: return fewer than 30 to stop pagination
            return {
              votes: [{ voter: 'juno1voterextra' }],
            }
          }
        }
        return {}
      })

      const result = await ProposalExtractor.sync!({
        config: extractor.env.config,
        autoCosmWasmClient: extractor.env.autoCosmWasmClient,
      })

      // Should have called list_proposals twice (pagination)
      expect(proposalCallCount).toBe(2)

      // Should have called list_votes twice for each of the 31 proposals
      expect(voteCallCount).toBe(62)

      // Should return 31 proposals + (31 * 31) votes = 992 items
      expect(result).toHaveLength(992)
    })

    it('should throw error when client is not connected in sync', async () => {
      const brokenAutoClient = {
        ...mockAutoCosmWasmClient,
        client: undefined,
      }

      await expect(
        ProposalExtractor.sync!({
          config: extractor.env.config,
          autoCosmWasmClient: brokenAutoClient as any,
        })
      ).rejects.toThrow('CosmWasm client not connected')
    })
  })
})
