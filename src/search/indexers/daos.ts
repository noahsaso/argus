import { Op, Sequelize } from 'sequelize'

import {
  Contract,
  Extraction,
  WasmStateEvent,
  WasmStateEventTransformation,
} from '@/db'
import { getEnv } from '@/formulas'
import { WasmCodeService } from '@/services/wasm-codes'
import {
  ContractEnv,
  FormulaType,
  MeilisearchIndexUpdate,
  MeilisearchIndexer,
} from '@/types'
import { getDaoAddressForProposalModule } from '@/webhooks'

export const daos: MeilisearchIndexer = {
  id: 'daos',
  index: 'daos',
  automatic: true,
  filterableAttributes: [
    'value.config.name',
    'value.config.description',
    'value.proposalCount',
    'value.hideFromSearch',
  ],
  sortableAttributes: ['value.proposalCount', 'value.createdAtEpoch'],
  matches: async ({ event, state }) => {
    if (!(event instanceof WasmStateEvent) && !(event instanceof Extraction)) {
      return
    }

    const contract =
      event instanceof WasmStateEvent
        ? event.contract
        : event instanceof Extraction
        ? await event.getContract()
        : undefined

    let daoAddress = contract?.matchesCodeIdKeys('dao-dao-core')
      ? contract.address
      : undefined

    // If not DAO, attempt to fetch DAO from proposal module. This will fail if
    // the address is not a proposal module. This is needed since the DAO dump
    // state formula includes the total proposal count which is fetched from
    // proposal modules.
    if (!daoAddress) {
      const env: ContractEnv = {
        ...getEnv({
          chainId: state.chainId,
          block: event.block,
          useBlockDate: true,
        }),
        contractAddress:
          event instanceof WasmStateEvent
            ? event.contractAddress
            : event.address,
      }
      daoAddress = await getDaoAddressForProposalModule(env)
    }

    return (
      !!daoAddress && {
        id: daoAddress,
        formula: {
          type: FormulaType.Contract,
          name: 'daoCore/dumpState',
          targetAddress: daoAddress,
        },
      }
    )
  },
  getBulkUpdates: async () => {
    const codeIds =
      WasmCodeService.getInstance().findWasmCodeIdsByKeys('dao-dao-core')
    if (!codeIds.length) {
      return []
    }

    const contracts = await Contract.findAll({
      where: {
        codeId: codeIds,
      },
    })

    return contracts.map(
      ({ address }): MeilisearchIndexUpdate => ({
        id: address,
        formula: {
          type: FormulaType.Contract,
          name: 'daoCore/dumpState',
          targetAddress: address,
        },
      })
    )
  },
}

export const daoProposals: MeilisearchIndexer = {
  id: 'dao-proposals',
  // Keep `proposals` for backwards compatibility reasons, even though the ID is
  // `dao-proposals`.
  index: 'proposals',
  automatic: true,
  filterableAttributes: [
    'value.id',
    'value.dao',
    'value.daoProposalId',
    'value.hideFromSearch',
    'value.proposal.title',
    'value.proposal.description',
    'value.proposal.proposer',
    'value.proposal.status',
  ],
  sortableAttributes: ['value.proposal.start_height'],
  matches: ({ event }) => {
    if (
      !(
        event instanceof WasmStateEventTransformation &&
        event.name.startsWith('proposal:') &&
        event.contract
      )
    ) {
      return
    }

    let name: string
    if (event.contract.matchesCodeIdKeys('dao-proposal-single')) {
      name = 'daoProposalSingle/proposal'
    } else if (event.contract.matchesCodeIdKeys('dao-proposal-multiple')) {
      name = 'daoProposalMultiple/proposal'
    } else {
      return
    }

    return (
      event.name.startsWith('proposal:') && {
        id: event.contractAddress + '_' + event.name.split(':')[1],
        formula: {
          type: FormulaType.Contract,
          name,
          targetAddress: event.contractAddress,
          args: {
            id: event.name.split(':')[1],
          },
        },
      }
    )
  },
  getBulkUpdates: async () => {
    const singleCodeIds = WasmCodeService.getInstance().findWasmCodeIdsByKeys(
      'dao-proposal-single'
    )
    const multipleCodeIds = WasmCodeService.getInstance().findWasmCodeIdsByKeys(
      'dao-proposal-multiple'
    )
    if (singleCodeIds.length + multipleCodeIds.length === 0) {
      return []
    }

    const events = await WasmStateEventTransformation.findAll({
      attributes: [
        // DISTINCT ON is not directly supported by Sequelize, so we need to
        // cast to unknown and back to string to insert this at the beginning of
        // the query. This ensures we use the most recent version of the name
        // for each contract.
        Sequelize.literal(
          'DISTINCT ON("name", "contractAddress") \'\''
        ) as unknown as string,
        'name',
        'contractAddress',
        'blockHeight',
        'blockTimeUnixMs',
        'value',
      ],
      where: {
        name: {
          [Op.like]: 'proposal:%',
        },
      },
      order: [
        // Needs to be first so we can use DISTINCT ON.
        ['name', 'ASC'],
        ['contractAddress', 'ASC'],
        // Descending block height ensures we get the most recent transformation
        // for the (contractAddress,name) pair.
        ['blockHeight', 'DESC'],
      ],
      include: [
        {
          model: Contract,
          required: true,
          where: {
            codeId: [...singleCodeIds, ...multipleCodeIds],
          },
        },
      ],
    })

    return events.map(
      ({ contractAddress, name, contract }): MeilisearchIndexUpdate => ({
        id: contractAddress + '_' + name.split(':')[1],
        formula: {
          type: FormulaType.Contract,
          name: singleCodeIds.includes(contract.codeId)
            ? 'daoProposalSingle/proposal'
            : multipleCodeIds.includes(contract.codeId)
            ? 'daoProposalMultiple/proposal'
            : // Should never happen.
              '',
          targetAddress: contractAddress,
          args: {
            id: name.split(':')[1],
          },
        },
      })
    )
  },
}
