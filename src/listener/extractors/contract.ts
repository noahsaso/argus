import { fromUtf8, toUtf8 } from '@cosmjs/encoding'

import { Contract, Extraction } from '@/db'
import { Extractor, ExtractorMaker } from '@/types'
import { retry } from '@/utils'

export type ContractsExtractorData = {
  addresses: string[]
}

export const contract: ExtractorMaker<ContractsExtractorData> = async ({
  autoCosmWasmClient,
}) => {
  const match: Extractor<ContractsExtractorData>['match'] = ({ events }) => {
    // Find addresses of contracts being instantiated.
    const addresses = events
      .filter(
        (e) =>
          (e.type === 'instantiate' || e.type === 'migrate') &&
          e.attributes.some((a) => a.key.includes('code_id')) &&
          e.attributes.some((a) => a.key === '_contract_address')
      )
      .flatMap((e) =>
        e.attributes
          .filter((a) => a.key === '_contract_address')
          .map((a) => a.value)
      )

    if (addresses.length === 0) {
      return
    }

    return {
      addresses,
    }
  }

  const extract: Extractor<ContractsExtractorData>['extract'] = async ({
    txHash,
    block: { height, timeUnixMs, timestamp },
    data: { addresses },
  }) => {
    await autoCosmWasmClient.update()
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    // Get contract data and info, and create extractions.
    const extractions = (
      await Promise.allSettled(
        addresses.map((address) =>
          retry(
            3,
            async () =>
              Promise.all([
                client.getContract(address),
                // Skip redundant getContract query in the normal
                // queryContractRaw.
                client['forceGetQueryClient']()
                  .wasm.queryContractRaw(address, toUtf8('contract_info'))
                  .catch(() => null),
              ]).then(
                ([contract, response]) =>
                  [
                    contract,
                    response?.data.length
                      ? {
                          address: contract.address,
                          name: 'info',
                          blockHeight: height,
                          blockTimeUnixMs: timeUnixMs,
                          txHash,
                          data: JSON.parse(fromUtf8(response.data)),
                        }
                      : null,
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
          instantiatedAtBlockTimeUnixMs: timeUnixMs,
          instantiatedAtBlockTimestamp: timestamp,
          txHash,
        })),
        {
          updateOnDuplicate: ['codeId', 'admin', 'creator', 'label'],
          conflictAttributes: ['address'],
        }
      ),
      Extraction.bulkCreate(
        extractions.flatMap(([, ...extractions]) =>
          extractions.flatMap((e) => e || [])
        ),
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
