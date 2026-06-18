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

export class XionBraleExtractor extends Extractor {
  static type = 'xion-brale'

  static sources: ExtractorDataSource[] = [
    BankTransferEventDataSource.source('nativeTransfer', {
      denom: {
        include: ['factory/xion17grq736740r70awldugfs3mls3stu9haewctv2/sbc'],
      },
      recipient: {
        include: ['xion1p6em2aklsy9q9jyuc9x8ykqpk24s3w6l4xu5r7'],
      },
    }),
    WasmEventDataSource.source('cw20Transfer', {
      key: 'action',
      value: 'transfer',
      contractAddress: [
        // TODO: Add tracked cw20 stablecoin contract addresses here (if using CW20 tokens)
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
            // TODO: Add Brale custodial recipient addresses here (same as above)
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
   * Process transfer and create extraction
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
        address: recipient,
        name: `brale/transfer/${type}`,
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
