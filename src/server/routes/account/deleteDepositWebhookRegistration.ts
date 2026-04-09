import Router from '@koa/router'
import { DefaultContext } from 'koa'

import { AccountDepositWebhookRegistration } from '@/db'

import { AccountState } from './types'

type DeleteDepositWebhookRegistrationResponse =
  | undefined
  | {
      error: string
    }

export const deleteDepositWebhookRegistration: Router.Middleware<
  AccountState,
  DefaultContext,
  DeleteDepositWebhookRegistrationResponse
> = async (ctx) => {
  const registration = await AccountDepositWebhookRegistration.findOne({
    where: {
      id: ctx.params.id,
      accountPublicKey: ctx.state.account.publicKey,
    },
  })

  if (!registration) {
    ctx.status = 404
    ctx.body = {
      error: 'Deposit webhook registration not found.',
    }
    return
  }

  await registration.destroy()
  ctx.status = 204
}
