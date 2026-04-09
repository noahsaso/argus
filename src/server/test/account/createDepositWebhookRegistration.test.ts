import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import { Account, AccountDepositWebhookRegistration } from '@/db'
import { getAccountWithAuth } from '@/test/utils'

import { app } from './app'

describe('POST /deposit-webhook-registrations', () => {
  let account: Account
  let token: string

  beforeEach(async () => {
    const { account: _account, token: _token } = await getAccountWithAuth()
    account = _account
    token = _token
  })

  it('returns error if no auth token', async () => {
    await request(app.callback())
      .post('/deposit-webhook-registrations')
      .send({})
      .expect(401)
      .expect({
        error: 'No token.',
      })
  })

  it('validates required fields', async () => {
    await request(app.callback())
      .post('/deposit-webhook-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400)
      .expect({
        error: 'Invalid endpoint URL.',
      })

    await request(app.callback())
      .post('/deposit-webhook-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpointUrl: 'https://partner.example/deposits',
      })
      .expect(400)
      .expect({
        error: 'At least one watched wallet is required.',
      })

    await request(app.callback())
      .post('/deposit-webhook-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpointUrl: 'https://partner.example/deposits',
        watchedWallets: ['xion1watchedwallet'],
      })
      .expect(400)
      .expect({
        error: 'At least one allowed asset filter is required.',
      })
  })

  it('creates a registration', async () => {
    const response = await request(app.callback())
      .post('/deposit-webhook-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Sandbox deposit listener',
        endpointUrl: 'https://partner.example/deposits',
        authHeader: 'Authorization',
        authToken: 'secret-token',
        watchedWallets: ['xion1watchedwallet'],
        allowedNativeDenoms: ['uxion'],
        allowedCw20Contracts: ['xion1stablecoincontract'],
      })
      .expect(201)

    expect(response.body.registration).toMatchObject({
      description: 'Sandbox deposit listener',
      endpointUrl: 'https://partner.example/deposits',
      authHeader: 'Authorization',
      authToken: 'secret-token',
      watchedWallets: ['xion1watchedwallet'],
      allowedNativeDenoms: ['uxion'],
      allowedCw20Contracts: ['xion1stablecoincontract'],
      enabled: true,
    })

    const registrations = await account.$get('depositWebhookRegistrations')
    expect(registrations).toHaveLength(1)
    expect(registrations[0].apiJson).toEqual(response.body.registration)
    expect(await AccountDepositWebhookRegistration.count()).toBe(1)
  })
})
