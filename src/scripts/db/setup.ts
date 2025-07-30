import * as fs from 'fs'
import path from 'path'
import * as readline from 'readline'

import { Command } from 'commander'

import { ConfigManager } from '@/config'
import { loadDb, setup as setupDb } from '@/db'
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
    '-w, --which <which>',
    'which database to setup (data, accounts, or both)',
    'both'
  )
  program.parse()
  const { config: _config, force, destroy = false, which } = program.opts()

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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const setup = async () => {
    try {
      if (dataSequelize) {
        await setupDb(dataSequelize, destroy, 'data')
        // Add migrations to data database.
        const migrations = fs.readdirSync(
          path.join(process.cwd(), './dist/db/migrations')
        )
        for (const migration of migrations) {
          await dataSequelize.query(
            `INSERT INTO "SequelizeMeta" ("name") VALUES ('${migration}') ON CONFLICT ("name") DO NOTHING;`
          )
        }
      }

      // Do not destroy accounts tables.
      if (accountsSequelize) {
        await setupDb(accountsSequelize, false, 'accounts')
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

  const close = async () => {
    await dataSequelize?.close()
    await accountsSequelize?.close()
    process.exit()
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
