import type { State } from '@/db'

import { Config } from './config'
import { DependableEventModel } from './db'
import { Env } from './formulas'

export enum WebhookType {
  Url = 'url',
  Soketi = 'soketi',
}

export type WebhookEndpoint =
  | {
      type: WebhookType.Url
      url: string
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      headers?: Record<string, string>
    }
  | {
      type: WebhookType.Soketi
      channel: string | string[]
      event: string
    }

export type Webhook<
  Event extends DependableEventModel = DependableEventModel,
  Value = any
> = {
  filter: {
    /**
     * Required to filter events by type. This should be set to the class itself
     * of the type of event to consider. This can be any class that extends
     * DependableEventModel, such as WasmStateEvent or GovProposal.
     */
    EventType: (new (...args: any) => Event) | (new (...args: any) => Event)[]
  } & Partial<{
    /**
     * If passed, contract must match one of these code IDs keys.
     *
     * Only relevant when event is a WasmStateEvent.
     */
    codeIdsKeys: string[]
    /**
     * If passed, contract must match one of these contract addresses.
     *
     * Only relevant when event is a WasmStateEvent.
     */
    contractAddresses: string[]
    /**
     * A function to support any custom matching logic.
     */
    matches: (event: Event, env: Env) => boolean
  }>
  // If returns undefined, the webhook will not be called.
  endpoint:
    | WebhookEndpoint
    | undefined
    | ((event: Event, env: Env) => WebhookEndpoint | undefined)
    | ((event: Event, env: Env) => Promise<WebhookEndpoint | undefined>)
  // If returns undefined, the webhook will not be called.
  getValue: (
    event: Event,
    getLastEvent: () => Promise<Event | null>,
    env: Env
  ) => Value | undefined | Promise<Value | undefined>
}

export type WebhookMaker<
  Event extends DependableEventModel = DependableEventModel,
  Value = any
> = (config: Config, state: State) => Webhook<Event, Value> | null | undefined

export type ProcessedWebhook<
  Event extends DependableEventModel = DependableEventModel,
  Value = any
> = Omit<Webhook<Event, Value>, 'filter'> & {
  filter: (event: Event, env: Env) => boolean
}

export type PendingWebhook = {
  eventType: string
  eventId: number
  endpoint: WebhookEndpoint
  value: any
}
