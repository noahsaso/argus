import { Contract as ChainContract } from '@cosmjs/cosmwasm-stargate'

import { Contract, Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { ExtractionJson, Extractor, ExtractorMaker } from '@/types'
import { batch } from '@/utils'

export type DaoExtractorData = {
  addresses: string[]
}

export const dao: ExtractorMaker<DaoExtractorData> = async ({
  autoCosmWasmClient,
}) => {
  const match: Extractor<DaoExtractorData>['match'] = ({ events }) => {
    const daoDaoCoreCodeIds =
      WasmCodeService.getInstance().findWasmCodeIdsByKeys('dao-dao-core')

    // Find DAO addresses by looking for dao-dao-core code IDs being
    // instantiated or DAO config being updated.

    const instantiated = events
      .filter(
        (e) =>
          e.type === 'instantiate' &&
          e.attributes.some(
            (a) =>
              a.key === 'code_id' &&
              !isNaN(Number(a.value)) &&
              daoDaoCoreCodeIds.includes(Number(a.value))
          )
      )
      .flatMap((e) =>
        e.attributes
          .filter((a) => a.key === '_contract_address')
          .map((a) => a.value)
      )

    const executeActions: (string | [string, string[]])[] = [
      'execute_proposal_hook',
      ['execute_update_config', ['name', 'description', 'image_url']],
      ['execute_accept_admin_nomination', ['new_admin']],
      'execute_update_voting_module',
      'execute_update_proposal_modules',
    ]

    const executions = events
      .filter(
        (e) =>
          e.type === 'wasm' &&
          e.attributes.some(
            (a) =>
              a.key === 'action' &&
              executeActions.some((action) =>
                typeof action === 'string'
                  ? action === a.value
                  : action[0] === a.value &&
                    action[1].every((key) =>
                      e.attributes.some((a) => a.key === key)
                    )
              )
          )
      )
      .flatMap((e) =>
        e.attributes
          .filter((a) => a.key === '_contract_address')
          .map((a) => a.value)
      )

    // Combine addresses from instantiations and executions.
    const addresses = [...instantiated, ...executions]

    if (addresses.length === 0) {
      return
    }

    return {
      addresses,
    }
  }

  const extract: Extractor<DaoExtractorData>['extract'] = async ({
    txHash,
    block: { height, timeUnixMs },
    data: { addresses },
  }) => {
    await autoCosmWasmClient.update()
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const daoDaoCoreCodeIds =
      WasmCodeService.getInstance().findWasmCodeIdsByKeys('dao-dao-core')

    // Get contract data, info, and dump state, and create extractions.
    const contracts: ChainContract[] = []
    const extractions: ExtractionJson[] = []
    await batch({
      list: addresses,
      batchSize: 25,
      task: async (address) => {
        const contract = await client.getContract(address)
        if (!daoDaoCoreCodeIds.includes(contract.codeId)) {
          return
        }

        const [{ info }, dumpState] = await Promise.all([
          client.queryContractSmart(address, {
            info: {},
          }),
          client.queryContractSmart(address, {
            dump_state: {},
          }),
        ])

        contracts.push(contract)
        extractions.push(
          {
            address: contract.address,
            name: 'info',
            blockHeight: height,
            blockTimeUnixMs: timeUnixMs,
            txHash,
            data: info,
          },
          {
            address: contract.address,
            name: 'dao-dao-core/dump_state',
            blockHeight: height,
            blockTimeUnixMs: timeUnixMs,
            txHash,
            data: dumpState,
          }
        )
      },
    })

    // Ensure contracts exist in the DB.
    const [, createdExtractions] = await Promise.all([
      Contract.bulkCreate(
        contracts.map((contract) => ({
          address: contract.address,
          codeId: contract.codeId,
          admin: contract.admin,
          creator: contract.creator,
          label: contract.label,
          instantiatedAtBlockHeight: height,
          instantiatedAtBlockTimeUnixMs: timeUnixMs,
          instantiatedAtBlockTimestamp: new Date(Number(timeUnixMs)),
          txHash,
        })),
        {
          updateOnDuplicate: ['codeId', 'admin', 'creator', 'label', 'txHash'],
          conflictAttributes: ['address'],
        }
      ),
      Extraction.bulkCreate(extractions, {
        updateOnDuplicate: ['blockTimeUnixMs', 'txHash', 'data'],
        conflictAttributes: ['address', 'name', 'blockHeight'],
        returning: true,
      }),
    ])

    return createdExtractions
  }

  const sync: Extractor<DaoExtractorData>['sync'] = async () => {
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const daoDaoCoreCodeIds =
      WasmCodeService.getInstance().findWasmCodeIdsByKeys('dao-dao-core')

    // Find all DAO contracts on the chain.
    const addresses: string[] = []
    for (const codeId of daoDaoCoreCodeIds) {
      const contracts = await client.getContracts(codeId)
      addresses.push(...contracts)
    }

    return [
      {
        addresses,
      },
    ]
  }

  return {
    match,
    extract,
    sync,
  }
}
