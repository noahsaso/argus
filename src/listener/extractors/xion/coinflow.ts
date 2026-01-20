import {
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
} from '@/types'

import {
  BankTransferEventData,
  BankTransferEventDataSource,
  WasmEventData,
  WasmEventDataSource,
} from '../../sources'
import { Extractor } from '../base'

export class XionCoinflowExtractor extends Extractor {
  static type = 'xion-coinflow'

  static sources: ExtractorDataSource[] = [
    BankTransferEventDataSource.source('nativeTransfer', {
      recipient: {
        include: [
          // Coinflow recipient addresses here...
        ],
      },
      denom: {
        include: [
          // Tracked denoms here (or delete the whole `denom` filter to track all)...
        ],
      },
    }),
    WasmEventDataSource.source('cw20Transfer', {
      key: 'action',
      value: 'transfer',
      contractAddress: [
        // Tracked cw20 contract addresses here...
      ],
      otherAttributes: [
        // Ensure presence
        'from',
        // Ensure presence
        'amount',
        // Ensure recipient is one of the allowed addresses
        {
          key: 'to',
          value: [
            // Coinflow recipient addresses here...
          ],
        },
      ],
    }),
  ]

  // Handler for native token transfers
  protected nativeTransfer: ExtractorHandler<BankTransferEventData> = ({
    sender,
    recipient,
    denom,
    amount,
  }) =>
    this.onTransfer({
      type: 'native',
      sender,
      recipient,
      denom,
      amount,
    })

  // Handler for cw20 token transfers
  protected cw20Transfer: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) =>
    this.onTransfer({
      type: 'cw20',
      sender: attributes.from![0],
      recipient: attributes.to![0],
      denom: address,
      amount: attributes.amount![0],
    })

  /**
   * Save contract config on instantiation
   */
  private async onTransfer({
    type,
    sender,
    recipient,
    denom,
    amount,
  }: {
    type: 'native' | 'cw20'
    sender: string
    recipient: string
    denom: string
    amount: string
  }): Promise<ExtractorHandlerOutput[]> {
    return [
      {
        address: sender,
        name: `coinflow/transfer/${type}`,
        data: {
          sender,
          recipient,
          denom,
          amount,
        },
      },
    ]
  }
}
