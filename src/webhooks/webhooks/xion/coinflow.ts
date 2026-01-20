import { Extraction } from '@/db'
import { WebhookMaker, WebhookType } from '@/types'

// Broadcast to Coinflow webhook when a relevant transfer occurs.
export const makeXionCoinflowTransfer: WebhookMaker<Extraction> = () => ({
  filter: {
    EventType: Extraction,
    matches: (event) => event.name.startsWith('coinflow/transfer/'),
  },
  endpoint: async (_event) => {
    return {
      type: WebhookType.Url,
      url: 'https://coinflow.webhook.endpoint/path',
      method: 'POST',
    }
  },
  getValue: async (event) => event.data,
})
