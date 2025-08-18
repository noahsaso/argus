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

    if (!daoAddress) {
      return
    }

    return {
      id: daoAddress,
      formula: {
        type: FormulaType.Contract,
        name: 'daoCore/dumpState',
        targetAddress: daoAddress,
      },
    }
  },
  getBulkUpdates: async () => {
    const codeIds =
      WasmCodeService.instance.findWasmCodeIdsByKeys('dao-dao-core')
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
  matches: async ({ event }) => {
    if (
      (!(event instanceof WasmStateEventTransformation && event.contract) &&
        !(event instanceof Extraction)) ||
      !event.name.startsWith('proposal:')
    ) {
      return
    }

    const contract =
      event instanceof WasmStateEventTransformation
        ? event.contract
        : event instanceof Extraction
        ? await event.getContract()
        : undefined

    if (!contract) {
      return
    }

    let name: string
    if (contract.matchesCodeIdKeys('dao-proposal-single')) {
      name = 'daoProposalSingle/proposal'
    } else if (contract.matchesCodeIdKeys('dao-proposal-multiple')) {
      name = 'daoProposalMultiple/proposal'
    } else {
      return
    }

    return {
      id: contract.address + '_' + event.name.split(':')[1],
      formula: {
        type: FormulaType.Contract,
        name,
        targetAddress: contract.address,
        args: {
          id: event.name.split(':')[1],
        },
      },
    }
  },
  getBulkUpdates: async () => {
    const singleCodeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
      'dao-proposal-single'
    )
    const multipleCodeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
      'dao-proposal-multiple'
    )
    if (singleCodeIds.length + multipleCodeIds.length === 0) {
      return []
    }

    const [transformations, extractions] = await Promise.all([
      WasmStateEventTransformation.findAll({
        attributes: [
          // DISTINCT ON is not directly supported by Sequelize, so we need to
          // cast to unknown and back to string to insert this at the beginning
          // of the query. This ensures we use the most recent version of the
          // name for each contract.
          Sequelize.literal(
            'DISTINCT ON("name", "contractAddress") \'\''
          ) as unknown as string,
          // Include `id` so that Sequelize doesn't prepend it to the query
          // before the DISTINCT ON, which must come first.
          'id',
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
          // Descending block height ensures we get the most recent
          // transformation for the (contractAddress,name) pair.
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
      }),
      Extraction.findAll({
        attributes: [
          // DISTINCT ON is not directly supported by Sequelize, so we need to
          // cast to unknown and back to string to insert this at the beginning
          // of the query. This ensures we use the most recent version of the
          // name for each contract.
          Sequelize.literal(
            'DISTINCT ON("name", "address") \'\''
          ) as unknown as string,
          // Include `id` so that Sequelize doesn't prepend it to the query
          // before the DISTINCT ON, which must come first.
          'id',
          'name',
          'address',
          'blockHeight',
          'blockTimeUnixMs',
          'data',
        ],
        where: {
          name: {
            [Op.like]: 'proposal:%',
          },
        },
        order: [
          // Needs to be first so we can use DISTINCT ON.
          ['name', 'ASC'],
          ['address', 'ASC'],
          // Descending block height ensures we get the most recent
          // transformation for the (contractAddress,name) pair.
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
      }),
    ])

    const getUpdate = (
      contractAddress: string,
      name: string,
      { codeId }: Contract
    ) => ({
      id: contractAddress + '_' + name.split(':')[1],
      formula: {
        type: FormulaType.Contract,
        name: singleCodeIds.includes(codeId)
          ? 'daoProposalSingle/proposal'
          : multipleCodeIds.includes(codeId)
          ? 'daoProposalMultiple/proposal'
          : // Should never happen.
            '',
        targetAddress: contractAddress,
        args: {
          id: name.split(':')[1],
        },
      },
    })

    const transformationUpdates = transformations.map(
      ({ contractAddress, name, contract }): MeilisearchIndexUpdate =>
        getUpdate(contractAddress, name, contract)
    )

    const extractionUpdates = extractions.flatMap(
      ({ address, name, contract }): MeilisearchIndexUpdate | [] =>
        contract ? getUpdate(address, name, contract) : []
    )

    return [...transformationUpdates, ...extractionUpdates]
  },
}
