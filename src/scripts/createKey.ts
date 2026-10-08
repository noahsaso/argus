import { Command } from 'commander'
import { Redis } from 'ioredis'

import { ConfigManager, getRedis, testRedisConnection } from '@/config'
import { Account, AccountKey, closeDb, loadDb } from '@/db'
import { DbType } from '@/types'

// Issues (or rotates) an operator API key for the indexer.
//
// The plaintext key is printed exactly once to stdout and is never stored or
// logged anywhere else; only its hash is saved in the accounts DB.

const program = new Command()
program.description(
  'Issue a new API key for an account (or rotate an existing key with --reset).'
)
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.requiredOption(
  '-a, --account <publicKey>',
  'account public key/identifier (created if it does not exist)'
)
program.option('-n, --name <name>', 'key name, unique per account (max 255)')
program.option('-d, --description <text>', 'key description (max 255)')
program.option(
  '--credits <amount>',
  'credit amount for the key: a positive integer, or -1 for unlimited',
  '-1'
)
program.option(
  '--reset <keyId>',
  "rotate an existing key's secret instead of creating a new key"
)
program.parse()
const options = program.opts<{
  config?: string
  account: string
  name?: string
  description?: string
  credits: string
  reset?: string
}>()

// Load config from specific config file.
ConfigManager.load(options.config)

const printKey = (lines: [string, string][], apiKey: string) => {
  console.log()
  for (const [label, value] of lines) {
    console.log(`${label.padEnd(12)} ${value}`)
  }
  console.log(`${'API key:'.padEnd(12)} ${apiKey}`)
  console.log()
  console.log(
    'Store this API key securely now. It is not saved anywhere and cannot be recovered; use --reset to rotate it.'
  )
}

const createKey = async () => {
  if (!options.name?.trim()) {
    throw new Error('--name is required when creating a key.')
  }

  // Only accept plain integers (e.g. reject "1.5", "10abc").
  if (!/^-?\d+$/.test(options.credits.trim())) {
    throw new Error('--credits must be a positive integer or -1 (unlimited).')
  }
  const credits = Number(options.credits)

  const { account, accountCreated, apiKey, accountKey, credit } =
    await Account.issueKey({
      accountPublicKey: options.account,
      name: options.name,
      description: options.description,
      credits,
    })

  printKey(
    [
      [
        'Account:',
        `${account.publicKey}${accountCreated ? ' (newly created)' : ''}`,
      ],
      ['Key ID:', String(accountKey.id)],
      ['Name:', accountKey.name],
      ...(accountKey.description
        ? [['Description:', accountKey.description] as [string, string]]
        : []),
      ['Credits:', credit.amount === '-1' ? 'unlimited' : credit.amount],
    ],
    apiKey
  )
}

const resetKey = async (keyId: string) => {
  if (!/^\d+$/.test(keyId)) {
    throw new Error('--reset must be a numeric key ID.')
  }

  const accountKey = await AccountKey.findOne({
    where: {
      id: Number(keyId),
      accountPublicKey: options.account.trim(),
    },
  })
  if (!accountKey) {
    throw new Error(`Key ${keyId} not found for account ${options.account}.`)
  }

  const apiKey = await accountKey.rotate()

  // The indexer caches API key -> key ID lookups in Redis for up to 7 days, so
  // remove any entries for this key so the old key stops working immediately.
  let cacheNote: string
  if (await testRedisConnection()) {
    let redis: Redis | undefined
    try {
      redis = getRedis()
      const cleared = await accountKey.clearCachedApiKeyLookups(redis)
      cacheNote = `cleared ${cleared} cached lookup(s); old key no longer works`
    } catch (err) {
      cacheNote = `FAILED to clear Redis cache (${
        err instanceof Error ? err.message : err
      }); old key may keep working for up to 7 days`
    } finally {
      await redis?.quit().catch(() => {})
    }
  } else {
    cacheNote =
      'Redis not configured/reachable; if the indexer uses Redis, the old key may keep working for up to 7 days'
  }

  printKey(
    [
      ['Account:', accountKey.accountPublicKey],
      ['Key ID:', String(accountKey.id)],
      ['Name:', accountKey.name],
      ['Old key:', 'revoked in DB'],
      ['Redis:', cacheNote],
    ],
    apiKey
  )
}

const main = async () => {
  await loadDb({
    type: DbType.Accounts,
  })

  try {
    if (options.reset !== undefined) {
      await resetKey(options.reset)
    } else {
      await createKey()
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  } finally {
    await closeDb()
  }

  // Exit explicitly since imported modules may hold open handles (e.g. queues).
  process.exit()
}

main()
