import Router from '@koa/router'
import { DefaultContext } from 'koa'

import {
  AccountDepositWebhookRegistration,
  AccountDepositWebhookRegistrationApiJson,
} from '@/db'

import { validateAndNormalizeDepositWebhookRegistration } from './depositWebhookRegistrationUtils'
import { AccountState } from './types'

type CreateDepositWebhookRegistrationRequest = Pick<
  AccountDepositWebhookRegistration,
  | 'description'
  | 'endpointUrl'
  | 'authHeader'
  | 'authToken'
  | 'watchedWallets'
  | 'allowedNativeDenoms'
  | 'allowedCw20Contracts'
  | 'enabled'
>

type CreateDepositWebhookRegistrationResponse =
  | {
      registration: AccountDepositWebhookRegistrationApiJson
    }
  | {
      error: string
    }

export const createDepositWebhookRegistration: Router.Middleware<
  AccountState,
  DefaultContext,
  CreateDepositWebhookRegistrationResponse
> = async (ctx) => {
  const body: CreateDepositWebhookRegistrationRequest = ctx.request.body

  const validation = validateAndNormalizeDepositWebhookRegistration({
    body,
    requireAll: true,
  })
  if ('error' in validation) {
    ctx.status = 400
    ctx.body = validation
    return
  }

  const registration =
    await ctx.state.account.$create<AccountDepositWebhookRegistration>(
      'depositWebhookRegistration',
      {
        ...validation.normalized,
        enabled: validation.normalized.enabled ?? true,
      }
    )

  ctx.status = 201
  ctx.body = {
    registration: registration.apiJson,
  }
}
