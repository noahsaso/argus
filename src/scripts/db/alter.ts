import { Command } from 'commander'

import { ConfigManager } from '@/config'
import {
  ALLOW_SYNC_ON_POPULATED_DB_ENV,
  PopulatedDatabaseError,
  assertSyncAllowed,
  isSyncOnPopulatedDbAllowedByEnv,
  loadDb,
} from '@/db'
import { DbType } from '@/types'

// Parse arguments.
const program = new Command()
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.option('-t, --type <data|accounts|both>', 'database type', 'both')
program.option(
  '--allow-populated',
  `alter even if a database already holds data (or set ${ALLOW_SYNC_ON_POPULATED_DB_ENV}=true); use db:migrate:data and db:migrate:accounts to upgrade existing databases instead`
)
program.parse()
const { config, type, allowPopulated = false } = program.opts()

// Verify type.
if (type !== 'data' && type !== 'accounts' && type !== 'both') {
  console.error(`Invalid type ${type}. Expected: data, accounts, or both.`)
  process.exit(1)
}

// Load config from specific config file.
ConfigManager.load(config)

export const main = async () => {
  // Log when altering.
  const dataSequelize =
    type === 'both' || type === 'data'
      ? await loadDb({
          type: DbType.Data,
          logging: true,
        })
      : undefined
  const accountsSequelize =
    type === 'both' || type === 'accounts'
      ? await loadDb({
          type: DbType.Accounts,
          logging: true,
        })
      : undefined

  // Refuse to alter databases that already hold data, unless explicitly
  // allowed.
  try {
    await assertSyncAllowed(
      [
        { name: 'data', sequelize: dataSequelize },
        { name: 'accounts', sequelize: accountsSequelize },
      ],
      {
        action: 'alter tables',
        allowPopulated: allowPopulated || isSyncOnPopulatedDbAllowedByEnv(),
      }
    )
  } catch (err) {
    console.error(err instanceof PopulatedDatabaseError ? err.message : err)
    await dataSequelize?.close()
    await accountsSequelize?.close()
    process.exit(1)
  }

  try {
    // Alter the database to match any changes.
    await dataSequelize?.sync({ alter: true })
    await accountsSequelize?.sync({ alter: true })

    console.log('\nAltered.')
  } catch (err) {
    console.error(err)
  }

  await dataSequelize?.close()
  await accountsSequelize?.close()
}

main()
