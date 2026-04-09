import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import { AccountDepositWebhookRegistration } from '@/db'
import { getAccountWithAuth } from '@/test/utils'

import { app } from './app'

describe('DELETE /deposit-webhook-registrations/:id', () => {
  let token: string
  let registration: AccountDepositWebhookRegistration

  beforeEach(async () => {
    const { account, token: _token } = await getAccountWithAuth()

    token = _token

    registration = await account.$create<AccountDepositWebhookRegistration>(
      'depositWebhookRegistration',
      {
        description: 'Sandbox deposit listener',
        endpointUrl: 'https://partner.example/deposits',
        watchedWallets: ['xion1watchedwallet'],
        allowedNativeDenoms: ['uxion'],
        allowedCw20Contracts: [],
      }
    )
  })

  it('returns error if no auth token', async () => {
    await request(app.callback())
      .delete(`/deposit-webhook-registrations/${registration.id}`)
      .expect(401)
      .expect({
        error: 'No token.',
      })
  })

  it('returns error if registration does not exist', async () => {
    await request(app.callback())
      .delete(`/deposit-webhook-registrations/${registration.id + 1}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect({
        error: 'Deposit webhook registration not found.',
      })
  })

  it('returns error if registration is owned by another account', async () => {
    const { account: anotherAccount } = await getAccountWithAuth()
    const anotherRegistration =
      await anotherAccount.$create<AccountDepositWebhookRegistration>(
        'depositWebhookRegistration',
        {
          description: 'Other',
          endpointUrl: 'https://other.example/deposits',
          watchedWallets: ['xion1otherwallet'],
          allowedNativeDenoms: ['uxion'],
          allowedCw20Contracts: [],
        }
      )

    await request(app.callback())
      .delete(`/deposit-webhook-registrations/${anotherRegistration.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect({
        error: 'Deposit webhook registration not found.',
      })
  })

  it('deletes registration', async () => {
    const initialCount = await AccountDepositWebhookRegistration.count()

    await request(app.callback())
      .delete(`/deposit-webhook-registrations/${registration.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204)

    expect(await AccountDepositWebhookRegistration.count()).toBe(
      initialCount - 1
    )
  })
})
