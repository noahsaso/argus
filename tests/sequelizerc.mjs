// Tests for .sequelizerc, which tells sequelize-cli where the migrations for
// db:migrate:data and db:migrate:accounts live. Each test loads the real file
// in a child process from a temporary project folder, so no database is needed:
//   node --test tests/sequelizerc.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const sequelizerc = path.join(repoRoot, '.sequelizerc')

let cwd
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-sequelizerc-'))
})
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
})

// Load .sequelizerc the way sequelize-cli does (require from the project root)
// and return the resolved options.
const load = (env) => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `process.stdout.write(JSON.stringify(require(${JSON.stringify(
        sequelizerc
      )})))`,
    ],
    {
      cwd,
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    }
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const mkdir = (...parts) =>
  fs.mkdirSync(path.join(cwd, ...parts), { recursive: true })
const exists = (...parts) => fs.existsSync(path.join(cwd, ...parts))
// Resolve through the real temporary path, which may be a symlink on macOS.
const resolved = (...parts) => path.join(fs.realpathSync(cwd), ...parts)

test('migrating accounts with no accounts migrations creates an empty compiled folder', () => {
  mkdir('dist', 'db', 'migrations', 'data')

  const options = load({ MIGRATING_DB: 'true', MIGRATIONS_DB: 'accounts' })

  assert.equal(
    options['migrations-path'],
    resolved('dist', 'db', 'migrations', 'accounts')
  )
  assert.ok(exists('dist', 'db', 'migrations', 'accounts'))
  assert.deepEqual(
    fs.readdirSync(path.join(cwd, 'dist', 'db', 'migrations', 'accounts')),
    []
  )
})

test('an empty source folder for a database also counts as no migrations', () => {
  mkdir('src', 'db', 'migrations', 'accounts')

  load({ MIGRATING_DB: 'true', MIGRATIONS_DB: 'accounts' })

  assert.ok(exists('dist', 'db', 'migrations', 'accounts'))
})

test('source migrations that were not built leave the compiled folder missing', () => {
  mkdir('src', 'db', 'migrations', 'accounts')
  fs.writeFileSync(
    path.join(
      cwd,
      'src',
      'db',
      'migrations',
      'accounts',
      '20260101000000-x.ts'
    ),
    ''
  )

  load({ MIGRATING_DB: 'true', MIGRATIONS_DB: 'accounts' })

  assert.equal(exists('dist', 'db', 'migrations', 'accounts'), false)
})

test('an existing compiled folder is used as is', () => {
  mkdir('dist', 'db', 'migrations', 'accounts')
  fs.writeFileSync(
    path.join(
      cwd,
      'dist',
      'db',
      'migrations',
      'accounts',
      '20260101000000-x.js'
    ),
    ''
  )

  const options = load({ MIGRATING_DB: 'true', MIGRATIONS_DB: 'accounts' })

  assert.equal(
    options['migrations-path'],
    resolved('dist', 'db', 'migrations', 'accounts')
  )
  assert.deepEqual(
    fs.readdirSync(path.join(cwd, 'dist', 'db', 'migrations', 'accounts')),
    ['20260101000000-x.js']
  )
})

test('data is the default database', () => {
  const options = load({ MIGRATING_DB: 'true' })

  assert.equal(
    options['migrations-path'],
    resolved('dist', 'db', 'migrations', 'data')
  )
})

test('generating (not migrating) uses the source folders and creates nothing', () => {
  const options = load({ MIGRATIONS_DB: 'accounts' })

  assert.equal(
    options['migrations-path'],
    resolved('src', 'db', 'migrations', 'accounts')
  )
  assert.equal(options['models-path'], resolved('src', 'db', 'models'))
  assert.equal(options.config, resolved('dist', 'db', 'config.js'))
  assert.equal(exists('src'), false)
  assert.equal(exists('dist'), false)
})
