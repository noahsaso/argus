import Router from '@koa/router'
import { DefaultContext } from 'koa'

import {
  AccountDepositWebhookRegistration,
  AccountDepositWebhookRegistrationApiJson,
} from '@/db'

import { validateAndNormalizeDepositWebhookRegistration } from './depositWebhookRegistrationUtils'
import { AccountState } from './types'

type UpdateDepositWebhookRegistrationRequest = Pick<
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

type UpdateDepositWebhookRegistrationResponse =
  | {
      registration: AccountDepositWebhookRegistrationApiJson
    }
  | {
      error: string
    }

export const updateDepositWebhookRegistration: Router.Middleware<
  AccountState,
  DefaultContext,
  UpdateDepositWebhookRegistrationResponse
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

  const body: UpdateDepositWebhookRegistrationRequest = ctx.request.body
  const validation = validateAndNormalizeDepositWebhookRegistration({
    body,
  })
  if ('error' in validation) {
    ctx.status = 400
    ctx.body = validation
    return
  }

  // Validate the final registration state if any asset filters are modified.
  const nextAllowedNativeDenoms =
    validation.normalized.allowedNativeDenoms ??
    registration.allowedNativeDenoms
  const nextAllowedCw20Contracts =
    validation.normalized.allowedCw20Contracts ??
    registration.allowedCw20Contracts
  if (
    nextAllowedNativeDenoms.length === 0 &&
    nextAllowedCw20Contracts.length === 0
  ) {
    ctx.status = 400
    ctx.body = {
      error: 'At least one allowed asset filter is required.',
    }
    return
  }

  const nextWatchedWallets =
    validation.normalized.watchedWallets ?? registration.watchedWallets
  if (nextWatchedWallets.length === 0) {
    ctx.status = 400
    ctx.body = {
      error: 'At least one watched wallet is required.',
    }
    return
  }

  await registration.update(validation.normalized)

  ctx.status = 200
  ctx.body = {
    registration: registration.apiJson,
  }
}
