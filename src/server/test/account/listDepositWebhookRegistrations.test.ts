import request from 'supertest'
import { beforeEach, describe, it } from 'vitest'

import { Account, AccountDepositWebhookRegistration } from '@/db'
import { getAccountWithAuth } from '@/test/utils'

import { app } from './app'

describe('GET /deposit-webhook-registrations', () => {
  let account: Account
  let token: string

  beforeEach(async () => {
    const { account: _account, token: _token } = await getAccountWithAuth()
    account = _account
    token = _token
  })

  it('returns error if no auth token', async () => {
    await request(app.callback())
      .get('/deposit-webhook-registrations')
      .expect(401)
      .expect({
        error: 'No token.',
      })
  })

  it('lists registrations for the authenticated account only', async () => {
    const registration =
      await account.$create<AccountDepositWebhookRegistration>(
        'depositWebhookRegistration',
        {
          description: 'Sandbox deposit listener',
          endpointUrl: 'https://partner.example/deposits',
          authHeader: 'Authorization',
          authToken: 'secret-token',
          watchedWallets: ['xion1watchedwallet'],
          allowedNativeDenoms: ['uxion'],
          allowedCw20Contracts: [],
        }
      )

    const { account: anotherAccount } = await getAccountWithAuth()
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
      .get('/deposit-webhook-registrations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({
        registrations: [registration.apiJson],
      })
  })
})
