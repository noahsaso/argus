import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  Contract,
  Extraction,
  State,
  WasmStateEvent,
  WasmStateEventTransformation,
} from '@/db'
import { WasmCode, WasmCodeService } from '@/services'
import { FormulaType } from '@/types'

import { daoProposals, daos } from './daos'

describe('DAO Search Indexer', () => {
  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    instance.addDefaultWasmCodes(new WasmCode('dao-dao-core', [1]))
  })

  beforeEach(async () => {
    await Contract.bulkCreate([
      {
        address: 'dao',
        codeId: 1,
      },
      {
        address: 'non-dao',
        codeId: 2,
      },
    ])
  })

  describe('matches', () => {
    it('should match DAOs with events', async () => {
      const event = WasmStateEvent.build({
        contractAddress: 'dao',
        key: 'key',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        blockTimestamp: new Date(),
        value: '"value"',
        valueJson: 'value',
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daos.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toEqual({
        id: 'dao',
        formula: {
          type: FormulaType.Contract,
          name: 'daoCore/dumpState',
          targetAddress: 'dao',
        },
      })
    })

    it('should match DAOs with extractions', async () => {
      const event = Extraction.build({
        address: 'dao',
        name: 'dao-dao-core/dump_state',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        data: {},
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daos.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toEqual({
        id: 'dao',
        formula: {
          type: FormulaType.Contract,
          name: 'daoCore/dumpState',
          targetAddress: 'dao',
        },
      })
    })

    it('should not match non-DAOs', async () => {
      const event = WasmStateEvent.build({
        contractAddress: 'non-dao',
        key: 'key',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        blockTimestamp: new Date(),
        value: '"value"',
        valueJson: 'value',
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daos.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toBeUndefined()
    })
  })

  describe('getBulkUpdates', () => {
    it('should get bulk updates for DAOs', async () => {
      const updates = await daos.getBulkUpdates!()
      expect(updates).toEqual([
        {
          id: 'dao',
          formula: {
            type: FormulaType.Contract,
            name: 'daoCore/dumpState',
            targetAddress: 'dao',
          },
        },
      ])
    })
  })
})

describe('DAO Proposal Search Indexer', () => {
  beforeAll(async () => {
    const instance = await WasmCodeService.setUpInstance()
    instance.addDefaultWasmCodes(
      new WasmCode('dao-proposal-single', [2]),
      new WasmCode('dao-proposal-multiple', [3])
    )
  })

  beforeEach(async () => {
    await Contract.bulkCreate([
      {
        address: 'single',
        codeId: 2,
      },
      {
        address: 'multiple',
        codeId: 3,
      },
      {
        address: 'not-proposal',
        codeId: 4,
      },
    ])
  })

  describe('matches', () => {
    it('should match single choice proposal module with transformation', async () => {
      const event = WasmStateEventTransformation.build({
        contractAddress: 'single',
        name: 'proposal:1',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        value: 'value',
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daoProposals.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toEqual({
        id: 'single_1',
        formula: {
          type: FormulaType.Contract,
          name: 'daoProposalSingle/proposal',
          targetAddress: 'single',
          args: {
            id: '1',
          },
        },
      })
    })

    it('should match multiple choice proposal module with transformation', async () => {
      const event = WasmStateEventTransformation.build({
        contractAddress: 'multiple',
        name: 'proposal:1',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        value: 'value',
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daoProposals.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toEqual({
        id: 'multiple_1',
        formula: {
          type: FormulaType.Contract,
          name: 'daoProposalMultiple/proposal',
          targetAddress: 'multiple',
          args: {
            id: '1',
          },
        },
      })
    })

    it('should match single choice proposal module with extraction', async () => {
      const event = Extraction.build({
        address: 'single',
        name: 'proposal:1',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        data: {},
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daoProposals.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toEqual({
        id: 'single_1',
        formula: {
          type: FormulaType.Contract,
          name: 'daoProposalSingle/proposal',
          targetAddress: 'single',
          args: {
            id: '1',
          },
        },
      })
    })

    it('should match multiple choice proposal module with extraction', async () => {
      const event = Extraction.build({
        address: 'multiple',
        name: 'proposal:1',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        data: {},
        txHash: 'txHash',
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daoProposals.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toEqual({
        id: 'multiple_1',
        formula: {
          type: FormulaType.Contract,
          name: 'daoProposalMultiple/proposal',
          targetAddress: 'multiple',
          args: {
            id: '1',
          },
        },
      })
    })

    it('should not match non-proposal modules', async () => {
      const event = WasmStateEvent.build({
        contractAddress: 'not-proposal',
        name: 'proposal:1',
        blockHeight: '1',
        blockTimeUnixMs: '1',
        value: 'value',
      })
      event.contract = (await event.$get('contract'))!

      const matches = await daoProposals.matches({
        event,
        state: await State.mustGetSingleton(),
      })

      expect(matches).toBeUndefined()
    })
  })

  describe('getBulkUpdates', () => {
    it('should get bulk updates for proposal modules', async () => {
      await WasmStateEventTransformation.bulkCreate([
        {
          contractAddress: 'single',
          name: 'proposal:1',
          blockHeight: '1',
          blockTimeUnixMs: '1',
          value: 'value',
        },
        {
          contractAddress: 'multiple',
          name: 'proposal:2',
          blockHeight: '2',
          blockTimeUnixMs: '2',
          value: 'value',
        },
        {
          contractAddress: 'not-proposal',
          name: 'proposal:3',
          blockHeight: '3',
          blockTimeUnixMs: '3',
          value: 'value',
        },
      ])

      await Extraction.bulkCreate([
        {
          address: 'single',
          name: 'proposal:4',
          blockHeight: '4',
          blockTimeUnixMs: '4',
          data: {},
          txHash: 'txHash',
        },
        {
          address: 'multiple',
          name: 'proposal:5',
          blockHeight: '5',
          blockTimeUnixMs: '5',
          data: {},
          txHash: 'txHash',
        },
        {
          address: 'not-proposal',
          name: 'proposal:6',
          blockHeight: '6',
          blockTimeUnixMs: '6',
          data: {},
          txHash: 'txHash',
        },
      ])

      const updates = await daoProposals.getBulkUpdates!()
      expect(updates).toEqual([
        {
          id: 'single_1',
          formula: {
            type: FormulaType.Contract,
            name: 'daoProposalSingle/proposal',
            targetAddress: 'single',
            args: {
              id: '1',
            },
          },
        },
        {
          id: 'multiple_2',
          formula: {
            type: FormulaType.Contract,
            name: 'daoProposalMultiple/proposal',
            targetAddress: 'multiple',
            args: {
              id: '2',
            },
          },
        },
        {
          id: 'single_4',
          formula: {
            type: FormulaType.Contract,
            name: 'daoProposalSingle/proposal',
            targetAddress: 'single',
            args: {
              id: '4',
            },
          },
        },
        {
          id: 'multiple_5',
          formula: {
            type: FormulaType.Contract,
            name: 'daoProposalMultiple/proposal',
            targetAddress: 'multiple',
            args: {
              id: '5',
            },
          },
        },
      ])
    })
  })
})
