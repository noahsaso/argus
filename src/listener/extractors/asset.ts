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
    // Track listing events (list, delist)
    WasmEventDataSource.source('listing', {
      key: 'action',
      value: ['list', 'delist'],
      otherAttributes: ['id', 'collection', 'seller'],
    }),
    // Track reservation events (reserve, unreserve)
    WasmEventDataSource.source('reservation', {
      key: 'action',
      value: ['reserve', 'unreserve'],
      otherAttributes: ['id', 'collection'],
    }),
    // Track purchase events (buy)
    WasmEventDataSource.source('purchase', {
      key: 'action',
      value: 'buy',
      otherAttributes: ['id', 'seller', 'buyer'],
    }),
  ]

  // Handler for contract instantiation
  protected instantiate: ExtractorHandler<WasmInstantiateOrMigrateData> = ({
    address,
  }) => this.saveConfig(address)

  // Handler for listing events
  protected listing: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.saveListing(address, attributes)

  // Handler for reservation events
  protected reservation: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.saveReservation(address, attributes)

  // Handler for purchase events
  protected purchase: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.savePurchase(address, attributes)

  /**
   * Save contract config on instantiation
   */
  private async saveConfig(address: string): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

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
   * Save listing data on list/delist events
   */
  private async saveListing(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

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
    const listingId = attributes.id?.[0]
    const collection = attributes.collection?.[0]
    const seller = attributes.seller?.[0]

    if (!listingId) {
      throw new Error('missing listing id')
    }

    const output: ExtractorHandlerOutput[] = []

    if (action === 'list') {
      const price = attributes.price?.[0]
      const denom = attributes.denom?.[0]
      const reservedUntil = attributes.reserved_until?.[0]

      // Save the listing
      output.push({
        address,
        name: `asset/listing:${listingId}`,
        data: {
          id: listingId,
          collection,
          price,
          denom,
          seller,
          reservedUntil: reservedUntil !== 'none' ? reservedUntil : null,
          status: 'active',
          listedAt: this.env.block.timeUnixMs,
          listedAtBlockHeight: this.env.block.height,
        },
      })

      // Index by collection
      if (collection) {
        output.push({
          address,
          name: `asset/collection:${collection}:listing:${listingId}`,
          data: {
            listingId,
            seller,
            price,
            denom,
          },
        })
      }

      // Index by seller
      if (seller) {
        output.push({
          address,
          name: `asset/seller:${seller}:listing:${listingId}`,
          data: listingId,
        })
      }
    } else if (action === 'delist') {
      // Update listing status to delisted
      output.push({
        address,
        name: `asset/listing:${listingId}`,
        data: {
          id: listingId,
          collection,
          seller,
          status: 'delisted',
          delistedAt: this.env.block.timeUnixMs,
          delistedAtBlockHeight: this.env.block.height,
        },
      })
    }

    return output
  }

  /**
   * Save reservation data on reserve/unreserve events
   */
  private async saveReservation(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

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
    const listingId = attributes.id?.[0]
    const collection = attributes.collection?.[0]
    const reserver = attributes.reserver?.[0]

    if (!listingId) {
      throw new Error('missing listing id')
    }

    const output: ExtractorHandlerOutput[] = []

    if (action === 'reserve') {
      const reservedUntil = attributes.reserved_until?.[0]

      output.push({
        address,
        name: `asset/reservation:${listingId}`,
        data: {
          listingId,
          collection,
          reserver,
          reservedUntil,
          status: 'reserved',
          reservedAt: this.env.block.timeUnixMs,
        },
      })

      // Index reservations by reserver
      if (reserver) {
        output.push({
          address,
          name: `asset/reserver:${reserver}:reservation:${listingId}`,
          data: listingId,
        })
      }
    } else if (action === 'unreserve') {
      const delisted = attributes.delisted?.[0]

      output.push({
        address,
        name: `asset/reservation:${listingId}`,
        data: {
          listingId,
          collection,
          reserver,
          status: 'unreserved',
          unreservedAt: this.env.block.timeUnixMs,
          delistedAfter: delisted === 'true',
        },
      })
    }

    return output
  }

  /**
   * Save purchase data on buy events
   */
  private async savePurchase(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process if it's an asset contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    const listingId = attributes.id?.[0]
    const price = attributes.price?.[0]
    const denom = attributes.denom?.[0]
    const seller = attributes.seller?.[0]
    const buyer = attributes.buyer?.[0]

    if (!listingId || !buyer) {
      throw new Error('missing required purchase attributes')
    }

    const output: ExtractorHandlerOutput[] = []

    // Generate unique sale ID
    const saleId = `${listingId}:${this.env.block.height}`

    // Record the sale
    output.push({
      address,
      name: `asset/sale:${saleId}`,
      data: {
        listingId,
        price,
        denom,
        seller,
        buyer,
        soldAt: this.env.block.timeUnixMs,
        soldAtBlockHeight: this.env.block.height,
        txHash: this.env.txHash,
      },
    })

    // Update listing status to sold
    output.push({
      address,
      name: `asset/listing:${listingId}`,
      data: {
        id: listingId,
        status: 'sold',
        soldAt: this.env.block.timeUnixMs,
        buyer,
        price,
        denom,
      },
    })

    // Index sale by buyer
    output.push({
      address,
      name: `asset/buyer:${buyer}:sale:${saleId}`,
      data: {
        saleId,
        listingId,
        price,
        denom,
        seller,
      },
    })

    // Index sale by seller
    if (seller) {
      output.push({
        address,
        name: `asset/seller:${seller}:sale:${saleId}`,
        data: {
          saleId,
          listingId,
          price,
          denom,
          buyer,
        },
      })
    }

    return output
  }

  /**
   * Sync historical data from existing contracts
   */
  static async *sync({
    autoCosmWasmClient,
  }: ExtractorSyncEnv): AsyncGenerator<DataSourceData, void, undefined> {
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const assetCodeIds =
      WasmCodeService.instance.findWasmCodeIdsByKeys(...CODE_IDS_KEYS)

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
