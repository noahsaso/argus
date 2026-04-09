import Router from '@koa/router'
import { DefaultContext } from 'koa'

import { AccountDepositWebhookRegistrationApiJson } from '@/db'

import { AccountState } from './types'

type ListDepositWebhookRegistrationsResponse = {
  registrations: AccountDepositWebhookRegistrationApiJson[]
}

export const listDepositWebhookRegistrations: Router.Middleware<
  AccountState,
  DefaultContext,
  ListDepositWebhookRegistrationsResponse
> = async (ctx) => {
  const registrations = await ctx.state.account.$get(
    'depositWebhookRegistrations',
    {
      order: [['id', 'ASC']],
    }
  )

  ctx.status = 200
  ctx.body = {
    registrations: registrations.map((registration) => registration.apiJson),
  }
}
