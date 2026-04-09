import { AccountDepositWebhookRegistration } from '@/db'
import {
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
} from '@/types'

import {
  IndexedWasmEventData,
  IndexedWasmEventDataSource,
  StargateMessageData,
  StargateMessageDataSource,
} from '../../sources'
import { Extractor } from '../base'

export const DEPOSIT_WEBHOOK_EXTRACTION_PREFIX = 'xion/deposit_webhook:'

export type DepositWebhookExtractionData = {
  registrationId: number
  idempotencyKey: string
  wallet: string
  recipient: string
  sender: string | null
  amount: string
  assetType: 'native' | 'cw20'
  denom: string | null
  contractAddress: string | null
  blockHeight: string
  blockTimeUnixMs: string
  txHash: string
}

type Coin = {
  denom: string
  amount: string
}

export const getDepositWebhookExtractionName = (idempotencyKey: string) =>
  `${DEPOSIT_WEBHOOK_EXTRACTION_PREFIX}${idempotencyKey}`

const normalizeAddress = (address: string) => address.trim()

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const asString = (value: unknown): string | undefined =>
  isNonEmptyString(value) ? value : undefined

const asCoins = (value: unknown): Coin[] =>
  Array.isArray(value)
    ? value.flatMap((coin) =>
        coin &&
        typeof coin === 'object' &&
        isNonEmptyString((coin as any).denom) &&
        isNonEmptyString((coin as any).amount)
          ? [
              {
                denom: (coin as any).denom,
                amount: (coin as any).amount,
              },
            ]
          : []
      )
    : []

const getBankMessageAddresses = (
  value: Record<string, unknown>
): {
  fromAddress?: string
  toAddress?: string
} => ({
  fromAddress: asString(value.fromAddress) ?? asString(value.from_address),
  toAddress: asString(value.toAddress) ?? asString(value.to_address),
})

export class XionDepositWebhookExtractor extends Extractor {
  static type = 'xion-deposit-webhook'

  static sources: ExtractorDataSource[] = [
    StargateMessageDataSource.source('bankTransfer', {
      typeUrl: [
        '/cosmos.bank.v1beta1.MsgSend',
        '/cosmos.bank.v1beta1.MsgMultiSend',
      ],
    }),
    IndexedWasmEventDataSource.source('cw20Transfer', {
      key: 'action',
      // Include send/send_from because watched deposit destinations may be
      // contracts as well as externally owned wallets. We still only emit when
      // the configured watched recipient matches exactly.
      value: ['transfer', 'transfer_from', 'send', 'send_from'],
      otherAttributes: ['recipient', 'amount'],
    }),
  ]

  protected bankTransfer: ExtractorHandler<StargateMessageData> = (data) =>
    this.extractBankTransfers(data)

  protected cw20Transfer: ExtractorHandler<IndexedWasmEventData> = (data) =>
    this.extractCw20Transfers(data)

  private get chainId(): string {
    const chainId =
      this.env.config.chainId || this.env.autoCosmWasmClient.chainId || ''

    if (!chainId) {
      throw new Error(
        'Could not determine chainId required for deposit webhook idempotency keys.'
      )
    }

    return chainId
  }

  private makeExtraction(
    registration: AccountDepositWebhookRegistration,
    wallet: string,
    sender: string | null,
    amount: string,
    assetType: 'native' | 'cw20',
    assetReference: string,
    uniqueIndex: string
  ): ExtractorHandlerOutput {
    const idempotencyKey = [
      this.chainId,
      registration.id,
      this.env.txHash,
      normalizeAddress(wallet),
      assetType,
      assetReference,
      amount,
      uniqueIndex,
    ].join(':')

    const data: DepositWebhookExtractionData = {
      registrationId: registration.id,
      idempotencyKey,
      wallet,
      recipient: wallet,
      sender,
      amount,
      assetType,
      denom: assetType === 'native' ? assetReference : null,
      contractAddress: assetType === 'cw20' ? assetReference : null,
      blockHeight: this.env.block.height,
      blockTimeUnixMs: this.env.block.timeUnixMs,
      txHash: this.env.txHash,
    }

    return {
      address: wallet,
      name: getDepositWebhookExtractionName(idempotencyKey),
      data,
    }
  }

  private async getRegistrations(): Promise<
    AccountDepositWebhookRegistration[]
  > {
    return await AccountDepositWebhookRegistration.getEnabledCached()
  }

  private async extractBankTransfers({
    typeUrl,
    value,
    messageIndex,
  }: StargateMessageData): Promise<ExtractorHandlerOutput[]> {
    const registrations = await this.getRegistrations()
    if (registrations.length === 0) {
      return []
    }

    if (typeUrl === '/cosmos.bank.v1beta1.MsgSend') {
      const { fromAddress, toAddress } = getBankMessageAddresses(value)
      if (!toAddress) {
        return []
      }

      return registrations.flatMap((registration) =>
        asCoins(value.amount)
          .filter(({ denom }) =>
            registration.matchesNativeDeposit(toAddress, denom)
          )
          .map(({ denom, amount }, coinIndex) =>
            this.makeExtraction(
              registration,
              toAddress,
              fromAddress ?? null,
              amount,
              'native',
              denom,
              `${messageIndex}:${coinIndex}`
            )
          )
      )
    }

    if (typeUrl === '/cosmos.bank.v1beta1.MsgMultiSend') {
      const inputs = Array.isArray(value.inputs) ? value.inputs : []
      const outputs = Array.isArray(value.outputs) ? value.outputs : []

      const inputAddresses = inputs
        .map((input) => asString((input as any)?.address))
        .filter(isNonEmptyString)
      const senders = [...new Set(inputAddresses)]
      // Multi-send can aggregate multiple input addresses into the same output.
      // When provenance is ambiguous, emit `null` instead of choosing one
      // arbitrarily so downstream consumers do not over-trust the sender field.
      const sender = senders.length === 1 ? senders[0] : null

      return outputs.flatMap((output, outputIndex) => {
        const wallet = asString((output as any)?.address)
        if (!wallet) {
          return []
        }

        return registrations.flatMap((registration) =>
          asCoins((output as any)?.coins)
            .filter(({ denom }) =>
              registration.matchesNativeDeposit(wallet, denom)
            )
            .map(({ denom, amount }, coinIndex) =>
              this.makeExtraction(
                registration,
                wallet,
                sender,
                amount,
                'native',
                denom,
                `${messageIndex}:${outputIndex}:${coinIndex}`
              )
            )
        )
      })
    }

    return []
  }

  private async extractCw20Transfers({
    address,
    attributes,
    eventIndex,
  }: IndexedWasmEventData): Promise<ExtractorHandlerOutput[]> {
    const registrations = await this.getRegistrations()
    if (registrations.length === 0) {
      return []
    }

    const contractAddress = normalizeAddress(address)
    const wallet = attributes.recipient?.[0]
    if (!wallet) {
      return []
    }

    const amount = attributes.amount?.[0]
    if (!amount) {
      return []
    }

    const sender =
      attributes.sender?.[0] ??
      attributes.owner?.[0] ??
      attributes.from?.[0] ??
      null

    return registrations
      .filter((registration) =>
        registration.matchesCw20Deposit(wallet, contractAddress)
      )
      .map((registration) =>
        this.makeExtraction(
          registration,
          wallet,
          sender,
          amount,
          'cw20',
          contractAddress,
          `${eventIndex}`
        )
      )
  }
}
