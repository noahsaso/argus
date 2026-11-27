import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { build } from 'tsup'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ALLOW_SYNC_ON_POPULATED_DB_ENV, loadDb } from '@/db'
import { DbType } from '@/types'

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
let scriptPath: string

/**
 * Run the compiled db:alter script in a separate process against the test
 * databases. Kills the process if it has not exited on its own in time.
 */
const runAlter = (args: string[] = []): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      // Let the bundle in the temporary folder resolve the repository's
      // dependencies.
      NODE_PATH: path.join(process.cwd(), 'node_modules'),
    }
    delete env[ALLOW_SYNC_ON_POPULATED_DB_ENV]

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

describe('db:alter', () => {
  beforeAll(async () => {
    // Compile the script the same way `npm run build` does.
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-db-alter-'))
    await build({
      entry: {
        alter: 'src/scripts/db/alter.ts',
      },
      outDir,
      splitting: false,
      sourcemap: false,
      clean: true,
      silent: true,
      noExternal: ['@dao-dao/types', '@burnt-labs/xion-types'],
    })
    scriptPath = path.join(outDir, 'alter.js')
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
})
