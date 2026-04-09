import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import { Account, AccountDepositWebhookRegistration } from '@/db'
import { getAccountWithAuth } from '@/test/utils'

import { app } from './app'

describe('PATCH /deposit-webhook-registrations/:id', () => {
  let account: Account
  let token: string
  let registration: AccountDepositWebhookRegistration

  beforeEach(async () => {
    const { account: _account, token: _token } = await getAccountWithAuth()
    account = _account
    token = _token

    registration = await account.$create<AccountDepositWebhookRegistration>(
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
  })

  it('returns error if no auth token', async () => {
    await request(app.callback())
      .patch(`/deposit-webhook-registrations/${registration.id}`)
      .expect(401)
      .expect({
        error: 'No token.',
      })
  })

  it('returns error if registration not found', async () => {
    await request(app.callback())
      .patch(`/deposit-webhook-registrations/${registration.id + 1}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect({
        error: 'Deposit webhook registration not found.',
      })
  })

  it('updates a registration', async () => {
    const response = await request(app.callback())
      .patch(`/deposit-webhook-registrations/${registration.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpointUrl: 'https://partner.example/prod-deposits',
        watchedWallets: ['xion1watchedwallet', 'xion1secondwallet'],
        allowedNativeDenoms: [],
        allowedCw20Contracts: ['xion1stablecoincontract'],
        enabled: false,
      })
      .expect(200)

    expect(response.body.registration).toMatchObject({
      id: registration.id,
      endpointUrl: 'https://partner.example/prod-deposits',
      watchedWallets: ['xion1watchedwallet', 'xion1secondwallet'],
      allowedNativeDenoms: [],
      allowedCw20Contracts: ['xion1stablecoincontract'],
      enabled: false,
    })

    await registration.reload()
    expect(registration.apiJson).toEqual(response.body.registration)
  })

  it('rejects removing all watched wallets or asset filters', async () => {
    await request(app.callback())
      .patch(`/deposit-webhook-registrations/${registration.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        watchedWallets: [],
      })
      .expect(400)
      .expect({
        error: 'At least one watched wallet is required.',
      })

    await request(app.callback())
      .patch(`/deposit-webhook-registrations/${registration.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        allowedNativeDenoms: [],
        allowedCw20Contracts: [],
      })
      .expect(400)
      .expect({
        error: 'At least one allowed asset filter is required.',
      })
  })
})
