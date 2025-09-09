import { Block, Contract, Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { Extractor, ExtractorMaker } from '@/types'
import { retry } from '@/utils'

export type DaoRbamExtractorData = {
  addresses: string[]
}

export const daoRbam: ExtractorMaker<DaoRbamExtractorData> = async ({
  autoCosmWasmClient,
}) => {
  const match: Extractor<DaoRbamExtractorData>['match'] = ({ events }) => {
    const daoRbamCodeIds =
      WasmCodeService.getInstance().findWasmCodeIdsByKeys('dao-rbam')

    const instantiated = events
      .filter(
        (e) =>
          e.type === 'instantiate' &&
          e.attributes.some(
            (a) =>
              a.key === 'code_id' &&
              !isNaN(Number(a.value)) &&
              daoRbamCodeIds.includes(Number(a.value))
          )
      )
      .flatMap((e) =>
        e.attributes
          .filter((a) => a.key === '_contract_address')
          .map((a) => a.value)
      )

    const executeActions: (string | [string, string[]])[] = [
      'create_role',
      'update_role',
      'assign',
      'revoke',
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

  const extract: Extractor<DaoRbamExtractorData>['extract'] = async ({
    txHash,
    height,
    data: { addresses },
  }) => {
    await autoCosmWasmClient.update()
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    // Get block time from the DB or RPC.
    const blockTimeUnixMs = await retry(
      3,
      () =>
        Block.findByPk(height).then((block) =>
          block
            ? Number(block.timeUnixMs)
            : client
                .getBlock(Number(height))
                .then((b) => Date.parse(b.header.time))
        ),
      1_000
    ).catch((err) => {
      console.error(`Error getting block time for height ${height}:`, err)
      return 0
    })

    // Get contract data, info, dao, assignments, and roles.
    const extractions = (
      await Promise.allSettled(
        addresses.map((address) =>
          retry(
            3,
            async () =>
              Promise.all([
                client.getContract(address),
                client.queryContractSmart(address, {
                  info: {},
                }),
                client.queryContractSmart(address, {
                  dao: {},
                }),
                client.queryContractSmart(address, {
                  list_assignments: {},
                }),
                client.queryContractSmart(address, {
                  list_roles: {},
                }),
              ]).then(
                ([contract, info, dao, assignments, roles]) =>
                  [
                    contract,
                    {
                      address: contract.address,
                      name: 'dao-rbam/info',
                      blockHeight: height,
                      blockTimeUnixMs,
                      txHash,
                      data: info,
                    },
                    {
                      address: contract.address,
                      name: 'dao-rbam/dao',
                      blockHeight: height,
                      blockTimeUnixMs,
                      txHash,
                      data: dao,
                    },
                    {
                      address: contract.address,
                      name: 'dao-rbam/list_assignments',
                      blockHeight: height,
                      blockTimeUnixMs,
                      txHash,
                      data: assignments,
                    },
                    {
                      address: contract.address,
                      name: 'dao-rbam/list_roles',
                      blockHeight: height,
                      blockTimeUnixMs,
                      txHash,
                      data: roles,
                    },
                  ] as const
              ),
            1_000
          )
        )
      )
    ).flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))

    // Ensure contracts exist in the DB.
    const [, createdExtractions] = await Promise.all([
      Contract.bulkCreate(
        extractions.map(([contract]) => ({
          address: contract.address,
          codeId: contract.codeId,
          admin: contract.admin,
          creator: contract.creator,
          label: contract.label,
          instantiatedAtBlockHeight: height,
          instantiatedAtBlockTimeUnixMs: blockTimeUnixMs,
          instantiatedAtBlockTimestamp: new Date(Number(blockTimeUnixMs)),
          txHash,
        })),
        {
          updateOnDuplicate: ['codeId', 'admin', 'creator', 'label', 'txHash'],
          conflictAttributes: ['address'],
        }
      ),
      Extraction.bulkCreate(
        extractions.flatMap(([, ...extractions]) => extractions),
        {
          updateOnDuplicate: ['blockTimeUnixMs', 'txHash', 'data'],
          conflictAttributes: ['address', 'name', 'blockHeight'],
          returning: true,
        }
      ),
    ])

    return createdExtractions
  }

  return {
    match,
    extract,
  }
}
