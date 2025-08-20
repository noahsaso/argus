import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { Contract, Extraction } from '@/db'
import { WasmCode, WasmCodeService } from '@/services'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'
import { AutoCosmWasmClient } from '@/utils'

import {
  WasmEventData,
  WasmEventDataSource,
  WasmInstantiateOrMigrateData,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { ProposalExtractor } from './proposal'

describe('Proposal Extractor', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let extractor: ProposalExtractor

  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    instance.addDefaultWasmCodes(
      new WasmCode('dao-dao-core', [1]),
      new WasmCode('dao-proposal-single', [2]),
      new WasmCode('dao-proposal-multiple', [3])
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
      expect(extractor.sources).toHaveLength(4)

      const instantiateSource = extractor.sources.find(
        (s) => s.type === WasmInstantiateOrMigrateDataSource.type
      )
      expect(instantiateSource).toBeDefined()
      expect(instantiateSource!.handler).toBe('instantiate')
      expect(instantiateSource!.config).toEqual({
        type: 'instantiate',
        codeIdsKeys: ['dao-proposal-single', 'dao-proposal-multiple'],
      })

      const configSource = extractor.sources.find(
        (s) =>
          s.type === WasmEventDataSource.type &&
          s.config.value === 'update_config'
      )
      expect(configSource).toBeDefined()
      expect(configSource!.handler).toBe('config')
      expect(configSource!.config).toEqual({
        key: 'action',
        value: 'update_config',
        otherAttributes: ['sender'],
      })

      const proposalActionSource = extractor.sources.find(
        (s) =>
          s.type === WasmEventDataSource.type &&
          Array.isArray(s.config.value) &&
          s.config.value.includes('propose')
      )
      expect(proposalActionSource).toBeDefined()
      expect(proposalActionSource!.handler).toBe('proposal')
      expect(proposalActionSource!.config).toEqual({
        key: 'action',
        value: ['propose', 'execute', 'vote', 'close'],
        otherAttributes: ['sender', 'proposal_id'],
      })

      const vetoSource = extractor.sources.find(
        (s) => s.type === WasmEventDataSource.type && s.config.value === 'veto'
      )
      expect(vetoSource).toBeDefined()
      expect(vetoSource!.handler).toBe('proposal')
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

    const mockConfig = {
      some_config: 'item',
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
        address: 'juno1proposal123',
        codeId: 2,
        admin: 'juno1admin123',
        creator: 'juno1creator123',
        label: 'Test Proposal Contract',
        ibcPortId: 'juno1ibc123',
      })
    })

    it('should extract config information successfully from instantiate', async () => {
      const data: ExtractorHandleableData[] = [
        WasmInstantiateOrMigrateDataSource.handleable('instantiate', {
          type: 'instantiate',
          address: 'juno1proposal123',
          codeId: 2,
          codeIdsKeys: ['dao-proposal-single', 'dao-proposal-multiple'],
        }),
      ]

      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockResolvedValueOnce(mockConfig) // config query

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('config')
      expect(result[0].data).toEqual(mockConfig)
    })

    it('should extract proposal information successfully from config update action', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('config', {
          address: 'juno1proposal123',
          key: 'action',
          value: 'update_config',
          attributes: {
            action: ['update_config'],
            sender: ['juno1proposer123'],
          },
          _attributes: [
            { key: 'action', value: 'update_config' },
            { key: 'sender', value: 'juno1proposer123' },
          ],
        }),
      ]

      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockResolvedValueOnce(mockConfig) // config query

      const result = (await extractor.extract(data)) as Extraction[]

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('config')
      expect(result[0].data).toEqual(mockConfig)
    })

    it('should extract proposal information successfully from propose action', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
        'juno1proposal123'
      )
      expect(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).toHaveBeenCalledTimes(2)

      expect(result).toHaveLength(2) // proposal + vetoer mapping

      // Check proposal extraction
      const proposalExtraction = result.find((e) => e.name === 'proposal:1')
      expect(proposalExtraction).toBeDefined()
      expect(proposalExtraction!.address).toBe('juno1proposal123')
      expect(proposalExtraction!.data).toEqual(mockProposal)

      // Check vetoer mapping (only created when proposing and vetoer exists)
      const vetoerExtraction = result.find(
        (e) => e.name === 'proposalVetoer:juno1vetoer123:1'
      )
      expect(vetoerExtraction).toBeDefined()
      expect(vetoerExtraction!.address).toBe('juno1proposal123')
      expect(vetoerExtraction!.data).toBe(1)
    })

    it('should extract vote information when vote is cast', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
      expect(voteExtraction!.address).toBe('juno1proposal123')
      expect(voteExtraction!.data).toEqual({
        ...mockVote,
        votedAt: '2022-01-01T01:00:00Z',
      })
    })

    it('should handle veto action without sender', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
      ).toHaveBeenCalledWith('juno1proposal123', {
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
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
      ).toHaveBeenCalledWith('juno1proposal123', {
        get_vote: {
          proposal_id: 1,
          voter: 'juno1voter123',
        },
      })

      expect(result).toHaveLength(2) // proposal + vote
    })

    it('should not extract if contract is not a proposal contract', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('proposal', {
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
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
      const contract = await Contract.findByPk('juno1proposal123')
      expect(contract).toBeDefined()
      expect(contract!.codeId).toBe(2)
      expect(contract!.admin).toBe('juno1admin123')
      expect(contract!.creator).toBe('juno1creator123')
      expect(contract!.label).toBe('Test Proposal Contract')
    })

    it('should throw error when proposal_id is missing', async () => {
      const data: ExtractorHandleableData[] = [
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
        WasmEventDataSource.handleable('proposal', {
          address: 'juno1proposal123',
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
    it('should sync config, proposal, and vote data for all contracts', async () => {
      // Mock contracts
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockImplementation(
        async (address: string) => {
          if (address === 'juno1dao') {
            return {
              address: 'juno1dao',
              codeId: 1,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test DAO',
              ibcPortId: 'juno1ibc123',
            }
          } else if (address === 'juno1proposal123') {
            return {
              address: 'juno1proposal123',
              codeId: 2,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test Proposal Contract',
              ibcPortId: 'juno1ibc123',
            }
          } else if (address === 'juno1proposal456') {
            return {
              address: 'juno1proposal456',
              codeId: 3,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test Proposal Contract',
              ibcPortId: 'juno1ibc123',
            }
          }
          throw new Error('Unknown contract')
        }
      )
      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 1) {
            return ['juno1dao']
          } else if (codeId === 2) {
            return ['juno1proposal123']
          } else if (codeId === 3) {
            return ['juno1proposal456']
          } else {
            return []
          }
        }
      )

      // Mock queries
      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, query: any) => {
        if (query.info) {
          if (address === 'juno1dao') {
            return {
              info: {
                contract: 'crates.io:dao-dao-core',
              },
            }
          }
        } else if (query.dump_state) {
          if (address === 'juno1dao') {
            return {
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
            }
          }
        } else if (query.list_proposals) {
          // Return mock proposals for different contracts
          if (address === 'juno1proposal123') {
            return {
              proposals: [{ id: 1 }, { id: 2 }],
            }
          } else if (address === 'juno1proposal456') {
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

      const result = await Array.fromAsync(
        ProposalExtractor.sync!({
          config: extractor.env.config,
          autoCosmWasmClient: extractor.env.autoCosmWasmClient,
        })
      )

      // Should return data for:
      // - 1 instantiate from DAO
      // - 1 instantiate from first proposal module
      // - 1 instantiate from second proposal module
      // - 2 proposals from first proposal module + 2 votes each = 6 items
      // - 1 proposal from second proposal module + 2 votes = 3 items
      // Total: 12 items
      expect(result).toHaveLength(12)

      // Check structure of returned data
      const instantiateSync = result.filter((r) => {
        return r.source === WasmInstantiateOrMigrateDataSource.type
      })
      const proposalSync = result.filter((r) => {
        return (
          r.source === WasmEventDataSource.type &&
          (r.data as WasmEventData).attributes.action?.[0] === 'propose'
        )
      })
      const voteSync = result.filter((r) => {
        return (
          r.source === WasmEventDataSource.type &&
          (r.data as WasmEventData).attributes.action?.[0] === 'vote'
        )
      })

      expect(instantiateSync).toHaveLength(3) // 3 instantiates total
      expect(proposalSync).toHaveLength(3) // 3 proposals total
      expect(voteSync).toHaveLength(6) // 6 votes total

      // Check specific instantiate handleable
      const firstInstantiate = instantiateSync.find((r) => {
        const data = r.data as WasmInstantiateOrMigrateData
        return data.address === 'juno1proposal123'
      })
      expect(firstInstantiate).toBeDefined()
      const firstInstantiateData = firstInstantiate!
        .data as WasmInstantiateOrMigrateData
      expect(firstInstantiateData.type).toEqual('instantiate')
      expect(firstInstantiateData.address).toEqual('juno1proposal123')
      expect(firstInstantiateData.codeId).toEqual(2)
      expect(firstInstantiateData.codeIdsKeys).toEqual(['dao-proposal-single'])

      // Check specific proposal handleable
      const firstProposal = proposalSync.find((r) => {
        const data = r.data as WasmEventData
        return (
          data.address === 'juno1proposal123' &&
          data.attributes.proposal_id?.[0] === '1'
        )
      })
      expect(firstProposal).toBeDefined()
      const firstProposalData = firstProposal!.data as WasmEventData
      expect(firstProposalData.attributes.action).toEqual(['propose'])

      // Check specific vote handleable
      const firstVote = voteSync.find((r) => {
        const data = r.data as WasmEventData
        return (
          data.address === 'juno1proposal123' &&
          data.attributes.sender?.[0] === 'juno1voter123'
        )
      })
      expect(firstVote).toBeDefined()
      const firstVoteData = firstVote!.data as WasmEventData
      expect(firstVoteData.attributes.action).toEqual(['vote'])
      expect(firstVoteData.attributes.position).toEqual(['placeholder'])
    })

    it('should handle pagination in sync function', async () => {
      vi.mocked(mockAutoCosmWasmClient.client!.getContract).mockImplementation(
        async (address: string) => {
          if (address === 'juno1dao') {
            return {
              address: 'juno1dao',
              codeId: 1,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test DAO',
              ibcPortId: 'juno1ibc123',
            }
          } else if (address === 'juno1proposal123') {
            return {
              address: 'juno1proposal123',
              codeId: 2,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test Proposal Contract',
              ibcPortId: 'juno1ibc123',
            }
          } else if (address === 'juno1proposal456') {
            return {
              address: 'juno1proposal456',
              codeId: 3,
              admin: 'juno1admin123',
              creator: 'juno1creator123',
              label: 'Test Proposal Contract',
              ibcPortId: 'juno1ibc123',
            }
          }
          throw new Error('Unknown contract')
        }
      )
      vi.mocked(mockAutoCosmWasmClient.client!.getContracts).mockImplementation(
        async (codeId: number) => {
          if (codeId === 1) {
            return ['juno1dao']
          } else if (codeId === 2) {
            return ['juno1proposal123']
          } else if (codeId === 3) {
            return ['juno1proposal456']
          } else {
            return []
          }
        }
      )

      let proposalCallCount = 0
      let voteCallCount = 0

      vi.mocked(
        mockAutoCosmWasmClient.client!.queryContractSmart
      ).mockImplementation(async (address: string, query: any) => {
        if (query.info) {
          if (address === 'juno1dao') {
            return {
              info: {
                contract: 'crates.io:dao-dao-core',
              },
            }
          }
        } else if (query.dump_state) {
          if (address === 'juno1dao') {
            return {
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
            }
          }
        } else if (query.list_proposals) {
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

      const result = await Array.fromAsync(
        ProposalExtractor.sync!({
          config: extractor.env.config,
          autoCosmWasmClient: extractor.env.autoCosmWasmClient,
        })
      )

      // Should have called list_proposals three times (pagination). Twice for
      // first proposal module, once for second proposal module.
      expect(proposalCallCount).toBe(3)

      // Should have called list_votes twice for each of the 31 proposals, plus
      // one more for the second proposal module.
      expect(voteCallCount).toBe(63)

      // Should return 3 instantiates (1 DAO + 2 proposal modules) + 32
      // proposals + (31 * 31) + 1 votes = 997 items
      expect(result).toHaveLength(997)
    })

    it('should throw error when client is not connected in sync', async () => {
      const brokenAutoClient = {
        ...mockAutoCosmWasmClient,
        client: undefined,
      }

      await expect(
        Array.fromAsync(
          ProposalExtractor.sync!({
            config: extractor.env.config,
            autoCosmWasmClient: brokenAutoClient as any,
          })
        )
      ).rejects.toThrow('CosmWasm client not connected')
    })
  })
})
