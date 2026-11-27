import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { build } from 'tsup'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ConfigManager } from '@/config'
import { ALLOW_SYNC_ON_POPULATED_DB_ENV, loadDb } from '@/db'
import { DB, DbType } from '@/types'

// How long the script may run before we decide it hangs. Altering both test
// databases takes a few seconds.
const EXIT_TIMEOUT_MS = 45_000

type RunResult = {
  // Exit code, or null if the script had to be killed.
  code: number | null
  timedOut: boolean
  output: string
}

let outDir: string

/**
 * Run a compiled sync script in a separate process against the test
 * databases. Kills the process if it has not exited on its own in time.
 */
const runScript = (
  script: 'alter' | 'setup',
  args: string[] = []
): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      // Let the bundle in the temporary folder resolve the repository's
      // dependencies.
      NODE_PATH: path.join(process.cwd(), 'node_modules'),
    }
    delete env[ALLOW_SYNC_ON_POPULATED_DB_ENV]

    const scriptPath = path.join(outDir, `${script}.js`)
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout.on('data', (data) => (output += data))
    child.stderr.on('data', (data) => (output += data))

    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, EXIT_TIMEOUT_MS)

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      resolve({
        code,
        timedOut,
        output,
      })
    })
  })

const runAlter = (args: string[] = []) => runScript('alter', args)

const writeConfig = (type: DbType, override: Partial<DB>) => {
  const configFile = path.join(outDir, 'config-schema.json')
  const config = ConfigManager.load()
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      ...config,
      db: { ...config.db, [type]: { ...config.db[type], ...override } },
    })
  )
  return configFile
}

describe('database sync scripts', () => {
  beforeAll(async () => {
    // Compile the scripts the same way `npm run build` does.
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-db-alter-'))
    await build({
      entry: {
        alter: 'src/scripts/db/alter.ts',
        setup: 'src/scripts/db/setup.ts',
      },
      outDir,
      splitting: false,
      sourcemap: false,
      clean: true,
      silent: true,
      noExternal: ['@dao-dao/types', '@burnt-labs/xion-types'],
    })
  }, 120_000)

  afterAll(() => {
    if (outDir) {
      fs.rmSync(outDir, {
        recursive: true,
        force: true,
      })
    }
  })

  afterEach(async () => {
    // Undo the schema change made by the failure test, so later tests see the
    // normal schema.
    const sequelize = await loadDb({
      type: DbType.Data,
    })
    await sequelize.query('DELETE FROM "Blocks"')
    await sequelize.query(
      'ALTER TABLE "Blocks" ALTER COLUMN "timeUnixMs" SET NOT NULL'
    )
  })

  it(
    'exits with code 0 by itself after altering both databases',
    async () => {
      const { code, timedOut, output } = await runAlter()

      expect(timedOut).toBe(false)
      expect(output).toContain('Altered.')
      expect(code).toBe(0)
    },
    EXIT_TIMEOUT_MS + 15_000
  )

  it(
    'exits with code 0 by itself after altering only the data database',
    async () => {
      const { code, timedOut, output } = await runAlter(['--type', 'data'])

      expect(timedOut).toBe(false)
      expect(output).toContain('Altered.')
      expect(code).toBe(0)
    },
    EXIT_TIMEOUT_MS + 15_000
  )

  it(
    'still refuses a populated database and exits with code 1',
    async () => {
      const sequelize = await loadDb({
        type: DbType.Data,
      })
      await sequelize.query(
        'INSERT INTO "Blocks" ("height", "timeUnixMs", "timestamp", "createdAt", "updatedAt") VALUES (1, 1, now(), now(), now())'
      )

      const { code, timedOut, output } = await runAlter()

      expect(timedOut).toBe(false)
      expect(output).toContain('Blocks')
      expect(output).not.toContain('Altered.')
      expect(code).toBe(1)
    },
    EXIT_TIMEOUT_MS + 15_000
  )

  it(
    'exits with code 1 by itself when altering fails',
    async () => {
      // A row the alter cannot satisfy: it sets "timeUnixMs" back to NOT NULL,
      // which fails while a row holds NULL.
      const sequelize = await loadDb({
        type: DbType.Data,
      })
      await sequelize.query(
        'ALTER TABLE "Blocks" ALTER COLUMN "timeUnixMs" DROP NOT NULL'
      )
      await sequelize.query(
        'INSERT INTO "Blocks" ("height", "timeUnixMs", "timestamp", "createdAt", "updatedAt") VALUES (1, NULL, now(), now(), now())'
      )

      const { code, timedOut, output } = await runAlter([
        '--type',
        'data',
        '--allow-populated',
      ])

      expect(timedOut).toBe(false)
      expect(output).toContain('contains null values')
      expect(output).not.toContain('Altered.')
      expect(code).toBe(1)
    },
    EXIT_TIMEOUT_MS + 15_000
  )

  describe('with configured schemas outside the default search path', () => {
    const schema = 'Sync guard.v1'

    it.each([
      {
        type: DbType.Data,
        table: 'Blocks',
        script: 'setup',
        configured: schema,
        refusal: `the data database already holds data (in "${schema}"."Blocks")`,
      },
      {
        type: DbType.Accounts,
        table: 'Accounts',
        script: 'alter',
        configured: schema,
        refusal: `the accounts database already holds data (in "${schema}"."Accounts")`,
      },
      {
        type: DbType.Data,
        table: 'Blocks',
        script: 'setup',
        configured: `"${schema}"`,
        refusal: 'Cannot verify the sync target',
      },
    ] as const)(
      'refuses $script before changing populated $type tables (schema: $configured)',
      async ({ type, table, script, configured, refusal }) => {
        const sequelize = await loadDb({ type })
        // The fixture is only in the schema in config; the connection's
        // default search path and the empty public tables are unchanged.
        const configPath = writeConfig(type, { schema: configured })
        const target = `"${schema}"."${table}"`
        await sequelize.query(`CREATE SCHEMA "${schema}";`)
        try {
          await sequelize.query(`CREATE TABLE ${target} (marker text);`)
          await sequelize.query(`INSERT INTO ${target} VALUES ('keep me');`)

          const { code, timedOut, output } = await runScript(script, [
            '--config',
            configPath,
            ...(script === 'setup'
              ? ['--which', type, '--force', '--destroy']
              : ['--type', type]),
          ])

          expect(timedOut).toBe(false)
          expect(output).toContain(refusal)
          expect(code).toBe(1)
          expect(
            (await sequelize.query(`SELECT marker FROM ${target};`))[0]
          ).toEqual([{ marker: 'keep me' }])
        } finally {
          await sequelize.query(`DROP SCHEMA "${schema}" CASCADE;`)
        }
      },
      EXIT_TIMEOUT_MS + 15_000
    )

    it(
      'syncs an empty configured schema even when public has a populated table with the same name',
      async () => {
        const sequelize = await loadDb({ type: DbType.Accounts })
        const configPath = writeConfig(DbType.Accounts, { schema })
        await sequelize.query(`CREATE SCHEMA "${schema}";`)
        try {
          await sequelize.query(`
            INSERT INTO public."Accounts" ("publicKey", "nonce", "createdAt", "updatedAt")
            VALUES ('decoy', 0, NOW(), NOW());
          `)

          const { code, timedOut, output } = await runScript('setup', [
            '--config',
            configPath,
            '--which',
            'accounts',
            '--force',
          ])

          expect(timedOut).toBe(false)
          expect(output).toContain('Synced all tables for accounts DB.')
          expect(code).toBe(0)
          expect(
            (await sequelize.query(`SELECT 1 FROM "${schema}"."Accounts";`))[0]
          ).toEqual([])
        } finally {
          await sequelize.query(`DROP SCHEMA "${schema}" CASCADE;`)
          await sequelize.query(
            `DELETE FROM public."Accounts" WHERE "publicKey" = 'decoy';`
          )
        }
      },
      EXIT_TIMEOUT_MS + 15_000
    )
  })

  it(
    'refuses an unqualified model table found later on the search path',
    async () => {
      const type = DbType.Data
      const sequelize = await loadDb({ type })
      // Use the same search path for all of the child process's connections.
      const configPath = writeConfig(type, {
        dialectOptions: {
          ...ConfigManager.load().db[type].dialectOptions,
          prependSearchPath: true,
          options: '-c search_path=sync_guard_first,public',
        },
      })
      await sequelize.query('CREATE SCHEMA sync_guard_first;')
      try {
        await sequelize.query(`
          INSERT INTO public."Blocks" ("height", "timeUnixMs", "timestamp", "createdAt", "updatedAt")
          VALUES (1, 1, now(), now(), now());
        `)

        const { code, timedOut, output } = await runAlter([
          '--config',
          configPath,
          '--type',
          type,
        ])

        expect(timedOut).toBe(false)
        expect(output).toContain(
          'the data database already holds data (in Blocks)'
        )
        expect(code).toBe(1)
      } finally {
        await sequelize.query('DROP SCHEMA sync_guard_first CASCADE;')
      }
    },
    EXIT_TIMEOUT_MS + 15_000
  )
})
