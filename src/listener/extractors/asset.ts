import { Contract } from '@/db'
import { WasmCodeService } from '@/services'
import {
  DataSourceData,
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
  ExtractorSyncEnv,
} from '@/types'
import { getContractInfo } from '@/utils'

import {
  WasmEventData,
  WasmEventDataSource,
  WasmInstantiateOrMigrateData,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { Extractor } from './base'

const CODE_IDS_KEYS = ['xion-asset']

export class AssetExtractor extends Extractor {
  static type = 'asset'

  static sources: ExtractorDataSource[] = [
    // Track contract instantiation
    WasmInstantiateOrMigrateDataSource.source('instantiate', {
      type: 'instantiate',
      codeIdsKeys: CODE_IDS_KEYS,
    }),
    // Track all known wasm events with action attribute
    WasmEventDataSource.source('allEvents', {
      key: 'action',
      value: [
        // CW721 standard actions (inherited from cw721-base)
        'mint',
        'burn',
        'transfer_nft',
        'send_nft',
        'approve',
        'revoke',
        'approve_all',
        'revoke_all',
        // Asset contract custom actions (from contracts/asset/src/execute/)
        'list',
        'delist',
        'reserve',
        'unreserve',
        'buy',
        'set_collection_plugin',
        'remove_collection_plugin',
      ],
    }),
  ]

  // Handler for contract instantiation
  protected instantiate: ExtractorHandler<WasmInstantiateOrMigrateData> = ({
    address,
  }) => this.saveConfig(address)

  // Handler for ALL wasm events
  protected allEvents: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.saveEvent(address, attributes)

  /**
   * Save contract config on instantiation
   */
  private async saveConfig(address: string): Promise<ExtractorHandlerOutput[]> {
    const contract = await getContractInfo({
      client: this.env.autoCosmWasmClient,
      address,
    })

    // Only process if it's an asset contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    // Ensure contract exists in the DB
    await Contract.upsert(
      {
        address: contract.address,
        codeId: contract.codeId,
        admin: contract.admin,
        creator: contract.creator,
        label: contract.label,
        txHash: this.env.txHash,
      },
      {
        fields: ['codeId', 'admin', 'creator', 'label'],
        returning: false,
      }
    )

    return [
      {
        address: contract.address,
        name: 'asset/config',
        data: {
          codeId: contract.codeId,
          admin: contract.admin,
          creator: contract.creator,
          label: contract.label,
        },
      },
    ]
  }

  /**
   * Save ALL wasm events from asset contracts
   */
  private async saveEvent(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const contract = await getContractInfo({
      client: this.env.autoCosmWasmClient,
      address,
    })

    // Only process if it's an asset contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    const action = attributes.action?.[0]
    if (!action) {
      return []
    }

    // Convert attributes to a flat object (take first value of each key)
    const flatAttributes: Record<string, string> = {}
    for (const [key, values] of Object.entries(attributes)) {
      if (values && values.length > 0) {
        flatAttributes[key] = values[0]
      }
    }

    // Create extraction name based on action
    const extractionName = `asset/${action}`

    return [
      {
        address,
        name: extractionName,
        data: {
          ...flatAttributes,
          blockHeight: this.env.block.height,
          blockTimeUnixMs: this.env.block.timeUnixMs,
          txHash: this.env.txHash,
        },
      },
    ]
  }

  /**
   * Sync historical data from existing contracts
   */
  static async *sync({
    autoCosmWasmClient,
  }: ExtractorSyncEnv): AsyncGenerator<DataSourceData, void, undefined> {
    const client = await autoCosmWasmClient.getValidClient()

    const assetCodeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
      ...CODE_IDS_KEYS
    )

    if (assetCodeIds.length === 0) {
      return
    }

    for (const codeId of assetCodeIds) {
      let contracts: readonly string[]
      try {
        contracts = await client.getContracts(codeId)
      } catch {
        continue
      }

      if (contracts.length === 0) {
        continue
      }

      // Yield instantiate events for each contract
      yield* contracts.map((address) =>
        WasmInstantiateOrMigrateDataSource.data({
          type: 'instantiate',
          address,
          codeId,
          codeIdsKeys: CODE_IDS_KEYS,
        })
      )

      // Query all listings from each contract for backfill
      for (const contractAddress of contracts) {
        try {
          // Paginate through all listings using the asset contract's query
          const limit = 30
          let startAfter: string | undefined

          while (true) {
            // Asset contract uses CW721 extension query format
            const response = await client.queryContractSmart(contractAddress, {
              extension: {
                msg: {
                  get_all_listings: {
                    start_after: startAfter,
                    limit,
                  },
                },
              },
            })

            const listings = response?.listings || response || []

            if (!Array.isArray(listings) || listings.length === 0) {
              break
            }

            // Yield listing events for each listing
            for (const listing of listings) {
              yield WasmEventDataSource.data({
                address: contractAddress,
                key: 'action',
                value: 'list',
                _attributes: [
                  { key: 'action', value: 'list' },
                  { key: 'id', value: listing.id || listing.token_id },
                  { key: 'collection', value: contractAddress },
                  {
                    key: 'price',
                    value: listing.price?.amount || String(listing.price),
                  },
                  { key: 'denom', value: listing.price?.denom || '' },
                  { key: 'seller', value: listing.seller },
                  {
                    key: 'reserved_until',
                    value: listing.reserved?.reserved_until || 'none',
                  },
                ],
              })
            }

            if (listings.length < limit) {
              break
            }

            startAfter = listings[listings.length - 1]?.id
          }
        } catch {
          // Ignore query errors for individual contracts
        }
      }
    }
  }
}
