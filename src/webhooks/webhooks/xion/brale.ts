import { Extraction } from '@/db'
import { WebhookMaker, WebhookType } from '@/types'

/**
 * Brale Transfer Webhook
 *
 * Sends transfer events to Brale's webhook endpoint for off-ramp processing.
 */
export const makeXionBraleTransfer: WebhookMaker<Extraction> = (config) => {
  // Only enable if webhook URL is configured
  if (!config.braleWebhookUrl) {
    return null
  }

  return {
    filter: {
      EventType: Extraction,
      matches: (event) => event.name.startsWith('brale/transfer/'),
    },
    endpoint: async (_event) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // Add authentication header if configured
      if (config.braleWebhookSecret) {
        headers['Authorization'] = `Bearer ${config.braleWebhookSecret}`
      }

      return {
        type: WebhookType.Url,
        url: config.braleWebhookUrl,
        method: 'POST',
        headers,
      }
    },
    getValue: async (event) => {
      // Transform to Brale's expected format
      return {
        // TODO: Which should we default to?
        chain: config.braleChainId || 'xion-mainnet-1',
        contract: event.data.denom,
        transaction_hash: event.txHash,
        from: event.data.sender,
        amount: event.data.amount,
        receiver: event.data.recipient,
      }
    },
  }
}
