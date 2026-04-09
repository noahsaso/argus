import { AccountDepositWebhookRegistration, Extraction } from '@/db'
import { DEPOSIT_WEBHOOK_EXTRACTION_PREFIX } from '@/listener/extractors/xion/depositWebhook'
import type { DepositWebhookExtractionData } from '@/listener/extractors/xion/depositWebhook'
import { WebhookMaker, WebhookType } from '@/types'

const DEFAULT_AUTH_HEADER = 'Authorization'

const getAuthHeaderValue = (authHeader: string, authToken: string) =>
  authHeader.toLowerCase() === DEFAULT_AUTH_HEADER.toLowerCase() &&
  !authToken.toLowerCase().startsWith('bearer ')
    ? `Bearer ${authToken}`
    : authToken

const isOptionalString = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === 'string'

const getDepositWebhookData = (
  event: Extraction
): DepositWebhookExtractionData => {
  const data = event.data

  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as DepositWebhookExtractionData).registrationId !== 'number' ||
    typeof (data as DepositWebhookExtractionData).idempotencyKey !== 'string' ||
    typeof (data as DepositWebhookExtractionData).wallet !== 'string' ||
    typeof (data as DepositWebhookExtractionData).recipient !== 'string' ||
    typeof (data as DepositWebhookExtractionData).amount !== 'string' ||
    !['native', 'cw20'].includes(
      String((data as DepositWebhookExtractionData).assetType)
    ) ||
    typeof (data as DepositWebhookExtractionData).blockHeight !== 'string' ||
    typeof (data as DepositWebhookExtractionData).blockTimeUnixMs !==
      'string' ||
    typeof (data as DepositWebhookExtractionData).txHash !== 'string' ||
    !isOptionalString((data as DepositWebhookExtractionData).sender) ||
    !isOptionalString((data as DepositWebhookExtractionData).denom) ||
    !isOptionalString((data as DepositWebhookExtractionData).contractAddress)
  ) {
    throw new Error(
      `Invalid deposit webhook extraction payload for event ${event.id}.`
    )
  }

  const depositData = data as DepositWebhookExtractionData
  if (
    (depositData.assetType === 'native' &&
      typeof depositData.denom !== 'string') ||
    (depositData.assetType === 'cw20' &&
      typeof depositData.contractAddress !== 'string')
  ) {
    throw new Error(
      `Invalid deposit webhook extraction payload for event ${event.id}.`
    )
  }

  return depositData
}

export const makeDepositDetectedWebhook: WebhookMaker<Extraction> = (
  _config
) => ({
  filter: {
    EventType: Extraction,
    matches: (event) =>
      event.name.startsWith(DEPOSIT_WEBHOOK_EXTRACTION_PREFIX),
  },
  endpoint: async (event) => {
    const deposit = getDepositWebhookData(event)
    const registration =
      await AccountDepositWebhookRegistration.findEnabledByPk(
        deposit.registrationId
      )
    if (!registration) {
      return
    }

    const header = registration.authHeader || DEFAULT_AUTH_HEADER

    return {
      type: WebhookType.Url,
      url: registration.endpointUrl,
      method: 'POST',
      headers: {
        ...(registration.authToken && {
          [header]: getAuthHeaderValue(header, registration.authToken),
        }),
        'Idempotency-Key': deposit.idempotencyKey,
      },
    }
  },
  getValue: async (event) => {
    const { registrationId: _registrationId, ...payload } =
      getDepositWebhookData(event)
    return payload
  },
})
