import { Redis } from 'ioredis'
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getRedis } from '@/config'
import { app as indexerApp } from '@/server/test/indexer/app'
import { getTypedFormula, restoreOriginalMocks } from '@/test/mocks'
import { FormulaType, TypedFormula } from '@/types'

import { Account } from './Account'
import { AccountKey } from './AccountKey'
import {
  AccountKeyCredit,
  AccountKeyCreditPaymentSource,
} from './AccountKeyCredit'
import { Contract } from './Contract'
import { State } from './State'

describe('Account.issueKey', () => {
  it('creates the account if needed and a key with an unlimited manual credit by default', async () => {
    expect(await Account.findByPk('operator-account')).toBeNull()

    const { account, accountCreated, apiKey, accountKey, credit } =
      await Account.issueKey({
        accountPublicKey: '  operator-account ',
        name: '  dao dao  ',
        description: '  frontend  ',
      })

    expect(accountCreated).toBe(true)
    expect(account.publicKey).toBe('operator-account')
    expect(await Account.findByPk('operator-account')).not.toBeNull()

    // Stores only the hash of the plaintext key.
    const storedKey = await AccountKey.findByPk(accountKey.id, {
      include: AccountKeyCredit,
    })
    expect(storedKey).not.toBeNull()
    expect(storedKey!.accountPublicKey).toBe('operator-account')
    expect(storedKey!.name).toBe('dao dao')
    expect(storedKey!.description).toBe('frontend')
    expect(storedKey!.hashedKey).toBe(AccountKey.hashKey(apiKey))
    expect(storedKey!.hashedKey).not.toContain(apiKey)
    expect((await AccountKey.findForKey(apiKey))?.id).toBe(accountKey.id)

    // Unlimited manual credit.
    expect(storedKey!.credits).toHaveLength(1)
    expect(storedKey!.credits[0].id).toBe(credit.id)
    expect(storedKey!.credits[0].paymentSource).toBe(
      AccountKeyCreditPaymentSource.Manual
    )
    expect(storedKey!.credits[0].amount).toBe('-1')
    expect(storedKey!.credits[0].paidFor).toBe(true)
  })

  it('uses an existing account', async () => {
    await Account.create({ publicKey: 'existing' })

    const { accountCreated, accountKey } = await Account.issueKey({
      accountPublicKey: 'existing',
      name: 'key',
    })

    expect(accountCreated).toBe(false)
    expect(accountKey.accountPublicKey).toBe('existing')
    expect(accountKey.description).toBeNull()
    expect(await Account.count()).toBe(1)
  })

  it('creates a finite manual credit', async () => {
    const { accountKey, credit } = await Account.issueKey({
      accountPublicKey: 'account',
      name: 'finite',
      credits: 5000,
    })

    await credit.reload()
    expect(credit.accountKeyId).toBe(accountKey.id)
    expect(credit.paymentSource).toBe(AccountKeyCreditPaymentSource.Manual)
    expect(credit.amount).toBe('5000')
    expect(credit.used).toBe('0')
    expect(credit.paidFor).toBe(true)

    expect(await accountKey.useCredit(5000)).toBe(true)
    expect(await accountKey.useCredit(1)).toBe(false)
  })

  it('rejects a duplicate name on the same account', async () => {
    await Account.issueKey({ accountPublicKey: 'account', name: 'dup' })

    await expect(
      Account.issueKey({ accountPublicKey: 'account', name: ' dup ' })
    ).rejects.toThrow('A key named "dup" already exists for account account.')

    expect(await AccountKey.count()).toBe(1)
    expect(await AccountKeyCredit.count()).toBe(1)

    // Same name on another account is fine.
    await Account.issueKey({ accountPublicKey: 'other', name: 'dup' })
    expect(await AccountKey.count()).toBe(2)
  })

  it('validates inputs without creating anything', async () => {
    await expect(
      Account.issueKey({ accountPublicKey: ' ', name: 'key' })
    ).rejects.toThrow('Missing account.')
    await expect(
      Account.issueKey({ accountPublicKey: 'account', name: '  ' })
    ).rejects.toThrow('Missing name.')
    await expect(
      Account.issueKey({ accountPublicKey: 'account', name: 'a'.repeat(256) })
    ).rejects.toThrow('Name too long.')
    await expect(
      Account.issueKey({
        accountPublicKey: 'account',
        name: 'key',
        description: 'a'.repeat(256),
      })
    ).rejects.toThrow('Description too long.')
    for (const credits of [0, -2, 1.5, NaN, Infinity]) {
      await expect(
        Account.issueKey({ accountPublicKey: 'account', name: 'key', credits })
      ).rejects.toThrow('Credits must be a positive integer or -1 (unlimited).')
    }

    // The transaction rolled back, so the account was not created either.
    expect(await Account.count()).toBe(0)
    expect(await AccountKey.count()).toBe(0)
    expect(await AccountKeyCredit.count()).toBe(0)
  })
})

describe('addInfiniteKey', () => {
  it('creates a key with an unlimited manual credit', async () => {
    const account = await Account.create({ publicKey: 'account' })
    const { apiKey } = await account.addInfiniteKey({ name: 'infinite' })

    const key = await AccountKey.findForKey(apiKey)
    expect(key?.name).toBe('infinite')
    const credits = await key!.$get('credits')
    expect(credits.map((c) => c.amount)).toEqual(['-1'])
  })
})

describe('issued key authenticates against the indexer', () => {
  let redis: Redis

  const query = (apiKey: string) =>
    request(indexerApp.callback())
      .get('/contract/valid_contract/formula')
      .set('x-api-key', apiKey)

  beforeEach(async () => {
    redis = getRedis()
    // DB IDs restart for each test but Redis is not reset, so remove cached
    // API key lookups left over from previous tests.
    const staleLookups = await redis.keys('accountKeyIdForApiKey:*')
    if (staleLookups.length) {
      await redis.del(...staleLookups)
    }

    await Contract.create({ address: 'valid_contract', codeId: 1 })
    await State.updateSingleton({
      latestBlockHeight: 1,
      latestBlockTimeUnixMs: 1,
    })

    getTypedFormula.mockImplementation(
      (type: FormulaType, name: string) =>
        ({
          name,
          type,
          formula: {
            compute: async () => 'ok',
          },
        } as unknown as TypedFormula)
    )
  })

  afterEach(async () => {
    restoreOriginalMocks()
    await redis.quit()
  })

  afterAll(() => {
    restoreOriginalMocks()
  })

  it('accepts the issued key and uses its credit', async () => {
    const { apiKey, credit } = await Account.issueKey({
      accountPublicKey: 'account',
      name: 'key',
      credits: 10,
    })

    await query(apiKey).expect(200).expect('"ok"')
    await query('not-a-key').expect(401).expect('invalid API key')

    await credit.reload()
    expect(credit.used).toBe('1')
    expect(credit.hits).toBe('1')
  })

  it('rotating a key revokes the old key once its Redis cache is cleared', async () => {
    const { apiKey: oldKey, accountKey } = await Account.issueKey({
      accountPublicKey: 'account',
      name: 'key',
    })

    // Authenticate once so the indexer caches the lookup in Redis.
    await query(oldKey).expect(200)
    await expect
      .poll(() => redis.get(`accountKeyIdForApiKey:${oldKey}`))
      .toBe(String(accountKey.id))

    // An unrelated cached lookup should be left alone.
    await redis.set(
      'accountKeyIdForApiKey:unrelated',
      String(accountKey.id + 1)
    )

    const newKey = await accountKey.rotate()
    expect(newKey).not.toBe(oldKey)
    await accountKey.reload()
    expect(accountKey.hashedKey).toBe(AccountKey.hashKey(newKey))
    expect(await AccountKey.findForKey(oldKey)).toBeNull()

    // Old key still works via the Redis cache until it is cleared.
    await query(oldKey).expect(200)

    expect(await accountKey.clearCachedApiKeyLookups(redis)).toBe(1)
    expect(await redis.get(`accountKeyIdForApiKey:${oldKey}`)).toBeNull()
    expect(await redis.get('accountKeyIdForApiKey:unrelated')).toBe(
      String(accountKey.id + 1)
    )
    await redis.del('accountKeyIdForApiKey:unrelated')

    await query(oldKey).expect(401).expect('invalid API key')
    await query(newKey).expect(200)
  })
})
