import path from 'path'
import * as readline from 'readline'

import { Command } from 'commander'

import { ConfigManager } from '@/config'
import {
  ALLOW_SYNC_ON_POPULATED_DB_ENV,
  PopulatedDatabaseError,
  assertSyncAllowed,
  isSyncOnPopulatedDbAllowedByEnv,
  loadDb,
  markMigrationsAsRun,
  setup as setupDb,
} from '@/db'
import { DbType } from '@/types'

export const main = async () => {
  // Parse arguments.
  const program = new Command()
  program.option(
    '-c, --config <path>',
    'path to config file, falling back to config.json'
  )
  program.option('-f, --force', "don't ask for confirmation")
  program.option('-d, --destroy', 'destroy tables if they already exist')
  program.option(
    '--allow-populated',
    `sync even if a database already holds data (or set ${ALLOW_SYNC_ON_POPULATED_DB_ENV}=true); use db:migrate:data and db:migrate:accounts to upgrade existing databases instead`
  )
  program.option(
    '-w, --which <which>',
    'which database to setup (data, accounts, or both)',
    'both'
  )
  program.parse()
  const {
    config: _config,
    force,
    destroy = false,
    which,
    allowPopulated = false,
  } = program.opts()

  // Load config from specific config file.
  ConfigManager.load(_config)

  const dataSequelize =
    which === 'data' || which === 'both'
      ? await loadDb({
          type: DbType.Data,
        })
      : null
  const accountsSequelize =
    which === 'accounts' || which === 'both'
      ? await loadDb({
          type: DbType.Accounts,
        })
      : null

  const close = async () => {
    await dataSequelize?.close()
    await accountsSequelize?.close()
    process.exit()
  }

  // Refuse to sync databases that already hold data, unless explicitly
  // allowed. Fresh databases (including ones where only migrations have run,
  // as in db:init) pass.
  try {
    await assertSyncAllowed(
      [
        { name: 'data', sequelize: dataSequelize },
        { name: 'accounts', sequelize: accountsSequelize },
      ],
      {
        action: destroy ? 'drop and recreate tables' : 'sync tables',
        allowPopulated: allowPopulated || isSyncOnPopulatedDbAllowedByEnv(),
      }
    )
  } catch (err) {
    console.error(err instanceof PopulatedDatabaseError ? err.message : err)
    process.exitCode = 1
    await close()
    return
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // The compiled migrations folder for each database, matching the
  // migrations-path in .sequelizerc that db:migrate:data and
  // db:migrate:accounts use.
  const getMigrationsPath = (type: 'data' | 'accounts') =>
    path.join(process.cwd(), 'dist', 'db', 'migrations', type)

  const markMigrations = async (
    sequelize: NonNullable<typeof dataSequelize>,
    type: 'data' | 'accounts',
    force: boolean
  ) => {
    const { inserted } = await markMigrationsAsRun(
      sequelize,
      getMigrationsPath(type),
      { force }
    )
    if (inserted.length) {
      console.log(
        `Recorded ${inserted.length} ${type} migration(s) as already run.`
      )
    }
  }

  const setup = async () => {
    try {
      if (dataSequelize) {
        await setupDb(dataSequelize, destroy, 'data')
        // Record migrations as run, since the tables match the current models.
        await markMigrations(dataSequelize, 'data', destroy)
      }

      // Do not destroy accounts tables.
      if (accountsSequelize) {
        await setupDb(accountsSequelize, false, 'accounts')
        await markMigrations(accountsSequelize, 'accounts', false)
      }

      console.log(
        `\n${
          destroy ? 'Dropped and recreated' : 'Synced'
        } all tables for ${which} DB${which === 'both' ? '(s)' : ''}.`
      )
    } catch (err) {
      console.error(err)
    }
  }

  if (force) {
    await setup()
    await close()
  } else {
    rl.question(
      `Are you sure you want to ${destroy ? 'recreate' : 'sync'} all tables?${
        destroy ? ' All existing data will be lost.' : ''
      } [y/n] `,
      async (answer) => {
        if (answer === 'y') {
          await setup()
        } else {
          console.log('Aborted.')
        }

        await close()
      }
    )
  }
}

main()
