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

const CODE_IDS_KEYS = ['xion-marketplace']

export class MarketplaceExtractor extends Extractor {
  static type = 'marketplace'

  static sources: ExtractorDataSource[] = [
    // Track contract instantiation
    WasmInstantiateOrMigrateDataSource.source('instantiate', {
      type: 'instantiate',
      codeIdsKeys: CODE_IDS_KEYS,
    }),
    // Track listing events (create_listing, cancel_listing)
    WasmEventDataSource.source('listing', {
      key: 'action',
      value: ['create_listing', 'cancel_listing'],
      otherAttributes: ['id'],
    }),
    // Track sale events (item_sold)
    WasmEventDataSource.source('sale', {
      key: 'action',
      value: 'item_sold',
      otherAttributes: ['id', 'seller', 'buyer'],
    }),
    // Track pending sale events
    WasmEventDataSource.source('pendingSale', {
      key: 'action',
      value: ['pending_sale_created', 'sale_approved', 'sale_rejected'],
      otherAttributes: ['collection', 'token_id'],
    }),
    // Track offer events (create_offer, cancel_offer)
    WasmEventDataSource.source('offer', {
      key: 'action',
      value: ['create_offer', 'cancel_offer'],
      otherAttributes: ['id'],
    }),
    // Track collection offer events
    WasmEventDataSource.source('collectionOffer', {
      key: 'action',
      value: ['create_collection_offer', 'cancel_collection_offer'],
      otherAttributes: ['id'],
    }),
    // Track config updates
    WasmEventDataSource.source('config', {
      key: 'action',
      value: 'update_config',
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

  // Handler for sale events
  protected sale: ExtractorHandler<WasmEventData> = ({ address, attributes }) =>
    this.saveSale(address, attributes)

  // Handler for pending sale events
  protected pendingSale: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.savePendingSale(address, attributes)

  // Handler for offer events
  protected offer: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.saveOffer(address, attributes)

  // Handler for collection offer events
  protected collectionOffer: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.saveCollectionOffer(address, attributes)

  // Handler for config updates
  protected config: ExtractorHandler<WasmEventData> = ({ address }) =>
    this.saveConfig(address)

  /**
   * Save marketplace config
   */
  private async saveConfig(address: string): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process if it's a marketplace contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    // Query the config from the contract
    let config
    try {
      config = await client.queryContractSmart(address, { config: {} })
    } catch {
      config = null
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
        name: 'marketplace/config',
        data: config || {
          codeId: contract.codeId,
          admin: contract.admin,
          creator: contract.creator,
          label: contract.label,
        },
      },
    ]
  }

  /**
   * Save listing data on create_listing/cancel_listing events
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

    // Only process if it's a marketplace contract
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
    const owner = attributes.owner?.[0]
    const collection = attributes.collection?.[0]
    const tokenId = attributes.token_id?.[0]
    const price = attributes.price?.[0]
    const reservedFor = attributes.reserved_for?.[0]

    if (!listingId) {
      throw new Error('missing listing id')
    }

    const output: ExtractorHandlerOutput[] = []

    if (action === 'create_listing') {
      // Save the listing
      output.push({
        address,
        name: `marketplace/listing:${listingId}`,
        data: {
          id: listingId,
          owner,
          collection,
          tokenId,
          price,
          reservedFor: reservedFor || null,
          status: 'active',
          createdAt: this.env.block.timeUnixMs,
          createdAtBlockHeight: this.env.block.height,
        },
      })

      // Index by collection
      if (collection) {
        output.push({
          address,
          name: `marketplace/collection:${collection}:listing:${listingId}`,
          data: {
            listingId,
            tokenId,
            price,
            owner,
          },
        })
      }

      // Index by owner
      if (owner) {
        output.push({
          address,
          name: `marketplace/owner:${owner}:listing:${listingId}`,
          data: listingId,
        })
      }

      // Index by token for quick lookup
      if (collection && tokenId) {
        output.push({
          address,
          name: `marketplace/token:${collection}:${tokenId}:listing`,
          data: listingId,
        })
      }
    } else if (action === 'cancel_listing') {
      // Update listing status
      output.push({
        address,
        name: `marketplace/listing:${listingId}`,
        data: {
          id: listingId,
          owner,
          collection,
          tokenId,
          status: 'cancelled',
          cancelledAt: this.env.block.timeUnixMs,
          cancelledAtBlockHeight: this.env.block.height,
        },
      })
    }

    return output
  }

  /**
   * Save sale data on item_sold events
   */
  private async saveSale(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process if it's a marketplace contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    const saleId = attributes.id?.[0]
    const seller = attributes.seller?.[0]
    const buyer = attributes.buyer?.[0]
    const collection = attributes.collection?.[0]
    const tokenId = attributes.token_id?.[0]
    const price = attributes.price?.[0]
    const offerId = attributes.offer_id?.[0]
    const collectionOfferId = attributes.collection_offer_id?.[0]

    if (!saleId || !buyer || !seller) {
      throw new Error('missing required sale attributes')
    }

    const output: ExtractorHandlerOutput[] = []

    // Record the sale
    output.push({
      address,
      name: `marketplace/sale:${saleId}`,
      data: {
        id: saleId,
        seller,
        buyer,
        collection,
        tokenId,
        price,
        offerId: offerId || null,
        collectionOfferId: collectionOfferId || null,
        soldAt: this.env.block.timeUnixMs,
        soldAtBlockHeight: this.env.block.height,
        txHash: this.env.txHash,
      },
    })

    // Update listing to sold
    output.push({
      address,
      name: `marketplace/listing:${saleId}`,
      data: {
        id: saleId,
        status: 'sold',
        buyer,
        price,
        soldAt: this.env.block.timeUnixMs,
      },
    })

    // Index sale by buyer
    output.push({
      address,
      name: `marketplace/buyer:${buyer}:sale:${saleId}`,
      data: {
        saleId,
        collection,
        tokenId,
        price,
        seller,
      },
    })

    // Index sale by seller
    output.push({
      address,
      name: `marketplace/seller:${seller}:sale:${saleId}`,
      data: {
        saleId,
        collection,
        tokenId,
        price,
        buyer,
      },
    })

    // Index sale by collection for volume tracking
    if (collection) {
      output.push({
        address,
        name: `marketplace/collection:${collection}:sale:${saleId}`,
        data: {
          saleId,
          tokenId,
          price,
          seller,
          buyer,
        },
      })
    }

    return output
  }

  /**
   * Save pending sale data
   */
  private async savePendingSale(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process if it's a marketplace contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    const action = attributes.action?.[0]
    const pendingSaleId = attributes.pending_sale_id?.[0] || attributes.id?.[0]
    const collection = attributes.collection?.[0]
    const tokenId = attributes.token_id?.[0]
    const buyer = attributes.buyer?.[0]
    const seller = attributes.seller?.[0]
    const price = attributes.price?.[0]

    if (!pendingSaleId) {
      throw new Error('missing pending sale id')
    }

    const output: ExtractorHandlerOutput[] = []

    if (action === 'pending_sale_created') {
      output.push({
        address,
        name: `marketplace/pendingSale:${pendingSaleId}`,
        data: {
          id: pendingSaleId,
          collection,
          tokenId,
          buyer,
          seller,
          price,
          status: 'pending',
          createdAt: this.env.block.timeUnixMs,
        },
      })

      // Index pending sales by buyer
      if (buyer) {
        output.push({
          address,
          name: `marketplace/buyer:${buyer}:pendingSale:${pendingSaleId}`,
          data: pendingSaleId,
        })
      }

      // Index pending sales by seller
      if (seller) {
        output.push({
          address,
          name: `marketplace/seller:${seller}:pendingSale:${pendingSaleId}`,
          data: pendingSaleId,
        })
      }
    } else if (action === 'sale_approved') {
      output.push({
        address,
        name: `marketplace/pendingSale:${pendingSaleId}`,
        data: {
          id: pendingSaleId,
          collection,
          tokenId,
          buyer,
          seller,
          price,
          status: 'approved',
          approvedAt: this.env.block.timeUnixMs,
        },
      })
    } else if (action === 'sale_rejected') {
      output.push({
        address,
        name: `marketplace/pendingSale:${pendingSaleId}`,
        data: {
          id: pendingSaleId,
          collection,
          tokenId,
          buyer,
          seller,
          price,
          status: 'rejected',
          rejectedAt: this.env.block.timeUnixMs,
        },
      })
    }

    return output
  }

  /**
   * Save offer data on create_offer/cancel_offer events
   */
  private async saveOffer(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process if it's a marketplace contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    const action = attributes.action?.[0]
    const offerId = attributes.id?.[0]
    const buyer = attributes.buyer?.[0]
    const collection = attributes.collection?.[0]
    const tokenId = attributes.token_id?.[0]
    const price = attributes.price?.[0]

    if (!offerId) {
      throw new Error('missing offer id')
    }

    const output: ExtractorHandlerOutput[] = []

    if (action === 'create_offer') {
      output.push({
        address,
        name: `marketplace/offer:${offerId}`,
        data: {
          id: offerId,
          buyer,
          collection,
          tokenId,
          price,
          status: 'active',
          createdAt: this.env.block.timeUnixMs,
        },
      })

      // Index by buyer
      if (buyer) {
        output.push({
          address,
          name: `marketplace/buyer:${buyer}:offer:${offerId}`,
          data: offerId,
        })
      }

      // Index by token
      if (collection && tokenId) {
        output.push({
          address,
          name: `marketplace/token:${collection}:${tokenId}:offer:${offerId}`,
          data: {
            offerId,
            buyer,
            price,
          },
        })
      }
    } else if (action === 'cancel_offer') {
      output.push({
        address,
        name: `marketplace/offer:${offerId}`,
        data: {
          id: offerId,
          buyer,
          collection,
          tokenId,
          status: 'cancelled',
          cancelledAt: this.env.block.timeUnixMs,
        },
      })
    }

    return output
  }

  /**
   * Save collection offer data
   */
  private async saveCollectionOffer(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process if it's a marketplace contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    const action = attributes.action?.[0]
    const offerId = attributes.id?.[0]
    const owner = attributes.owner?.[0] || attributes.buyer?.[0]
    const collection = attributes.collection?.[0]
    const price = attributes.price?.[0]

    if (!offerId) {
      throw new Error('missing collection offer id')
    }

    const output: ExtractorHandlerOutput[] = []

    if (action === 'create_collection_offer') {
      output.push({
        address,
        name: `marketplace/collectionOffer:${offerId}`,
        data: {
          id: offerId,
          owner,
          collection,
          price,
          status: 'active',
          createdAt: this.env.block.timeUnixMs,
        },
      })

      // Index by collection
      if (collection) {
        output.push({
          address,
          name: `marketplace/collection:${collection}:collectionOffer:${offerId}`,
          data: {
            offerId,
            owner,
            price,
          },
        })
      }

      // Index by owner
      if (owner) {
        output.push({
          address,
          name: `marketplace/owner:${owner}:collectionOffer:${offerId}`,
          data: offerId,
        })
      }
    } else if (action === 'cancel_collection_offer') {
      output.push({
        address,
        name: `marketplace/collectionOffer:${offerId}`,
        data: {
          id: offerId,
          owner,
          collection,
          status: 'cancelled',
          cancelledAt: this.env.block.timeUnixMs,
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

    const marketplaceCodeIds =
      WasmCodeService.instance.findWasmCodeIdsByKeys(...CODE_IDS_KEYS)

    if (marketplaceCodeIds.length === 0) {
      return
    }

    for (const codeId of marketplaceCodeIds) {
      let contracts: readonly string[]
      try {
        contracts = await client.getContracts(codeId)
      } catch {
        continue
      }

      if (contracts.length === 0) {
        continue
      }

      // Yield instantiate for each contract to get config
      yield* contracts.map((address) =>
        WasmInstantiateOrMigrateDataSource.data({
          type: 'instantiate',
          address,
          codeId,
          codeIdsKeys: CODE_IDS_KEYS,
        })
      )

      // Note: The marketplace contract has limited query methods.
      // It only has individual query methods (Config, Listing, Offer, etc.)
      // and no list methods to query all listings/offers.
      // Historical backfill for listings/offers would need to come from
      // event history via the RPC or from the asset contracts directly.
    }
  }
}
