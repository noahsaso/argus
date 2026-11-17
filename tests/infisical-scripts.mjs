// Tests for the Infisical token scripts in infisical/. Each test runs the real
// script as a child process against a local fake Infisical API, so no network
// access, database or Infisical account is needed:
//   node --test tests/infisical-scripts.mjs
import assert from 'node:assert/strict'
import { execFile, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  accessTokenId,
  lockPathFor,
  parseEnv,
  redact,
  setEnvValue,
  withEnvLock,
  writeFileAtomic,
  writeTokenToEnvFile,
} from '../infisical/common.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const script = (name) => path.join(repoRoot, 'infisical', name)

const fakeJwt = (id, salt = '') =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url'
    ),
    Buffer.from(
      JSON.stringify({ identityAccessTokenId: id, salt, authTokenType: 'x' })
    ).toString('base64url'),
    Buffer.from(`signature-${id}-${salt}`).toString('base64url'),
  ].join('.')

const OLD_ID = '11111111-1111-4111-8111-111111111111'
const NEW_ID = '22222222-2222-4222-8222-222222222222'
const OLD_TOKEN = fakeJwt(OLD_ID, 'old')
const RENEWED_TOKEN = fakeJwt(OLD_ID, 'renewed')
const NEW_TOKEN = fakeJwt(NEW_ID, 'new')
const CLIENT_ID = 'client-id-abcdef'
const CLIENT_SECRET = 'client-secret-0123456789abcdef'
const SECRETS = [OLD_TOKEN, RENEWED_TOKEN, NEW_TOKEN, CLIENT_SECRET]

// Fake Infisical API. `handlers[route]` returns [status, body] for a parsed
// request body; every request is recorded.
//
// The server is started with top-level await rather than in a before() hook:
// on Node 18.17.1 (the deployed runtime) a top-level before() hook does not
// run before tests nested in describe() blocks, so the scripts would fall
// back to the real Infisical API.
let requests
let handlers

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined
    requests.push({ method: req.method, url: req.url, body })
    const handler = handlers[req.url]
    const [status, response] = handler
      ? handler(body)
      : [404, { message: 'not found' }]
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
// Do not keep the test process alive if the after() hook does not run.
server.unref()
const apiUrl = `http://127.0.0.1:${server.address().port}/api`

after(() => new Promise((resolve) => server.close(resolve)))

let dir
beforeEach(() => {
  requests = []
  handlers = {}
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infisical-scripts-'))
})

const writeEnv = (name, lines) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 })
  return file
}

const run = (name, args = []) =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [script(name), ...args],
      { cwd: dir, env: { ...process.env, INFISICAL_API_URL: apiUrl } },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stdout, stderr })
    )
  })

const assertNoSecrets = (result) => {
  const output = result.stdout + result.stderr
  for (const secret of SECRETS) {
    assert.ok(!output.includes(secret), 'output must not contain a secret')
  }
  assert.ok(!/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(output), 'no JWT')
}

const modeOf = (file) => fs.statSync(file).mode & 0o777

const baseEnv = [
  '# indexer env',
  `INFISICAL_CLIENT_ID=${CLIENT_ID}`,
  `INFISICAL_CLIENT_SECRET=${CLIENT_SECRET}`,
  'INFISICAL_ENVIRONMENT=prod',
  'INFISICAL_PROJECT_ID=project-1',
]

describe('helpers', () => {
  test('parseEnv handles comments, export and quotes', () => {
    assert.deepEqual(
      parseEnv('# c\nA=1\nexport B="two words"\nC=\'x=y\'\n\nbad line\n'),
      { A: '1', B: 'two words', C: 'x=y' }
    )
  })

  test('setEnvValue replaces in place or appends', () => {
    assert.equal(
      setEnvValue('A=1\nT=old\nB=2\n', 'T', 'new'),
      'A=1\nT=new\nB=2\n'
    )
    assert.equal(setEnvValue('A=1\n', 'T', 'new'), 'A=1\nT=new\n')
    assert.equal(setEnvValue('A=1', 'T', 'new'), 'A=1\nT=new')
  })

  test('parseEnv uses the last occurrence and strips inline comments', () => {
    assert.deepEqual(
      parseEnv('T=first\nA=1 # note\nB="x # y" # note\nT=last\n'),
      { T: 'last', A: '1', B: 'x # y' }
    )
  })

  test('setEnvValue collapses duplicate lines into one', () => {
    const updated = setEnvValue(
      'T=old1\nX=1\nexport T=old2\nY=2\nT=old3\n',
      'T',
      'new'
    )
    assert.equal(updated, 'T=new\nX=1\nY=2\n')
    assert.equal(parseEnv(updated).T, 'new')
  })

  test('writeFileAtomic creates mode 600 and leaves no temp file', () => {
    const file = path.join(dir, '.env')
    fs.writeFileSync(file, 'A=1\n', { mode: 0o644 })
    writeFileAtomic(file, 'A=2\n')
    assert.equal(fs.readFileSync(file, 'utf8'), 'A=2\n')
    assert.equal(modeOf(file), 0o600)
    assert.deepEqual(fs.readdirSync(dir), ['.env'])
  })

  test('redact removes JWTs and listed secrets', () => {
    assert.equal(
      redact(`bad ${OLD_TOKEN} and ${CLIENT_SECRET}`, [CLIENT_SECRET]),
      'bad [REDACTED] and [REDACTED]'
    )
  })

  test('accessTokenId reads the ID claim only', () => {
    assert.equal(accessTokenId(OLD_TOKEN), OLD_ID)
    assert.equal(accessTokenId('not-a-jwt'), 'unknown')
  })
})

describe('renew.mjs', () => {
  test('renews over HTTPS body and rewrites .env atomically', async () => {
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      {
        accessToken: RENEWED_TOKEN,
        expiresIn: 2592000,
        accessTokenMaxTTL: 0,
        tokenType: 'Bearer',
      },
    ]
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    fs.chmodSync(env, 0o644)

    const result = await run('renew.mjs')

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(requests, [
      {
        method: 'POST',
        url: '/api/v1/auth/token/renew',
        body: { accessToken: OLD_TOKEN },
      },
    ])
    assert.equal(
      fs.readFileSync(env, 'utf8'),
      [...baseEnv, `INFISICAL_TOKEN=${RENEWED_TOKEN}`].join('\n') + '\n'
    )
    assert.equal(modeOf(env), 0o600)
    assert.deepEqual(fs.readdirSync(dir), ['.env'])
    assert.match(result.stdout, new RegExp(`Renewed access token ${OLD_ID}`))
    assertNoSecrets(result)
  })

  test('fails without touching .env and without echoing the token', async () => {
    handlers['/api/v1/auth/token/renew'] = () => [
      401,
      { statusCode: 401, message: `Token ${OLD_TOKEN} is invalid` },
    ]
    const lines = [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`]
    const env = writeEnv('.env', lines)

    const result = await run('renew.mjs')

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /HTTP 401/)
    assert.equal(fs.readFileSync(env, 'utf8'), lines.join('\n') + '\n')
    assertNoSecrets(result)
  })

  test('renews when .env has duplicate INFISICAL_TOKEN lines', async () => {
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      { accessToken: RENEWED_TOKEN, expiresIn: 60 },
    ]
    const env = writeEnv('.env', [
      `INFISICAL_TOKEN=${NEW_TOKEN}`,
      ...baseEnv,
      `INFISICAL_TOKEN=${OLD_TOKEN}`,
    ])

    const result = await run('renew.mjs')

    assert.equal(result.code, 0, result.stderr)
    // The last line is the one dotenv loads, so it is the one renewed.
    assert.deepEqual(requests[0].body, { accessToken: OLD_TOKEN })
    const contents = fs.readFileSync(env, 'utf8')
    assert.equal(contents.match(/^INFISICAL_TOKEN=/gm).length, 1)
    assert.equal(parseEnv(contents).INFISICAL_TOKEN, RENEWED_TOKEN)
    assertNoSecrets(result)
  })

  test('keeps a token rotated while the renewal was in flight', async () => {
    const rotated = [...baseEnv, `INFISICAL_TOKEN=${NEW_TOKEN}`]
    let env
    handlers['/api/v1/auth/token/renew'] = () => {
      // A login or rotation stores a new token before the renewal returns.
      fs.writeFileSync(env, rotated.join('\n') + '\n', { mode: 0o600 })
      return [200, { accessToken: RENEWED_TOKEN, expiresIn: 60 }]
    }
    env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])

    const result = await run('renew.mjs')

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(requests[0].body, { accessToken: OLD_TOKEN })
    assert.equal(fs.readFileSync(env, 'utf8'), rotated.join('\n') + '\n')
    assert.match(result.stdout, /Discarded the renewed token/)
    assertNoSecrets(result)
  })

  test('refuses to store a malformed token', async () => {
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      { accessToken: `${RENEWED_TOKEN}#x`, expiresIn: 60 },
    ]
    const lines = [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`]
    const env = writeEnv('.env', lines)

    const result = await run('renew.mjs')

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /malformed token/)
    assert.equal(fs.readFileSync(env, 'utf8'), lines.join('\n') + '\n')
    assertNoSecrets(result)
  })

  test('fails when INFISICAL_TOKEN is missing', async () => {
    writeEnv('.env', baseEnv)
    const result = await run('renew.mjs')
    assert.notEqual(result.code, 0)
    assert.equal(requests.length, 0)
  })

  test('infisical-renew.sh delegates to the Node script', async () => {
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      { accessToken: RENEWED_TOKEN, expiresIn: 60 },
    ]
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    fs.mkdirSync(path.join(dir, 'infisical'))
    for (const name of ['renew.mjs', 'common.mjs']) {
      fs.copyFileSync(script(name), path.join(dir, 'infisical', name))
    }
    const result = await new Promise((resolve) =>
      execFile(
        'sh',
        [path.join(repoRoot, 'infisical-renew.sh')],
        { cwd: dir, env: { ...process.env, INFISICAL_API_URL: apiUrl } },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, stdout, stderr })
      )
    )
    assert.equal(result.code, 0, result.stderr)
    assert.match(fs.readFileSync(env, 'utf8'), new RegExp(RENEWED_TOKEN))
    assertNoSecrets(result)
  })
})

describe('token lock', () => {
  const lockFile = () => lockPathFor(path.join(dir, '.env'))

  // A process ID that is certainly not running any more.
  const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid

  // Start a process that holds the token lock, reads .env (the "check"),
  // waits `holdMs`, then replaces the token with `token` (the "rename"), the
  // way a renewal paused between its check and its rename would. Resolves
  // once the lock is held; `done` resolves with the exit code.
  const startHolder = async (token, holdMs) => {
    const ready = path.join(dir, 'holder-ready')
    const source = `
      import fs from 'node:fs'
      import { TOKEN_KEY, setEnvValue, withEnvLock, writeFileAtomic } from ${JSON.stringify(
        new URL('../infisical/common.mjs', import.meta.url).href
      )}
      const envPath = process.env.HOLDER_ENV
      withEnvLock(envPath, () => {
        const current = fs.readFileSync(envPath, 'utf8')
        fs.writeFileSync(process.env.HOLDER_READY, 'ready')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.HOLDER_MS))
        writeFileAtomic(envPath, setEnvValue(current, TOKEN_KEY, process.env.HOLDER_TOKEN))
      })
    `
    const holderScript = path.join(dir, 'holder.mjs')
    fs.writeFileSync(holderScript, source)
    // The token travels in the environment, not on the command line.
    const child = spawn(process.execPath, [holderScript], {
      env: {
        ...process.env,
        HOLDER_ENV: path.join(dir, '.env'),
        HOLDER_READY: ready,
        HOLDER_MS: String(holdMs),
        HOLDER_TOKEN: token,
      },
      stdio: 'inherit',
    })
    const done = new Promise((resolve) => child.on('exit', resolve))
    while (!fs.existsSync(ready)) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return { done }
  }

  test('login waits for a writer that is between its check and rename', async () => {
    handlers['/api/v1/auth/universal-auth/login'] = () => [
      200,
      { accessToken: NEW_TOKEN, expiresIn: 60 },
    ]
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    // A renewal has checked .env (still OLD) and is about to store RENEWED.
    const holder = await startHolder(RENEWED_TOKEN, 700)

    const result = await run('login.mjs')

    assert.equal(await holder.done, 0)
    assert.equal(result.code, 0, result.stderr)
    // Without the lock, the holder's later rename would replace NEW.
    assert.equal(
      parseEnv(fs.readFileSync(env, 'utf8')).INFISICAL_TOKEN,
      NEW_TOKEN
    )
    assert.equal(modeOf(env), 0o600)
    assert.ok(!fs.existsSync(lockFile()))
    assertNoSecrets(result)
  })

  test('renewal discards its result after waiting for a login', async () => {
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      { accessToken: RENEWED_TOKEN, expiresIn: 60 },
    ]
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    // A login holds the lock and stores NEW while the renewal is running.
    const holder = await startHolder(NEW_TOKEN, 700)

    const result = await run('renew.mjs')

    assert.equal(await holder.done, 0)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /Discarded the renewed token/)
    assert.equal(
      parseEnv(fs.readFileSync(env, 'utf8')).INFISICAL_TOKEN,
      NEW_TOKEN
    )
    assert.ok(!fs.existsSync(lockFile()))
    assertNoSecrets(result)
  })

  test('a lock held by a live process times out without changing .env', async () => {
    const lines = [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`]
    const env = writeEnv('.env', lines)
    const sleeper = spawn(process.execPath, [
      '-e',
      'setTimeout(() => {}, 30000)',
    ])
    try {
      fs.writeFileSync(lockFile(), `${sleeper.pid}\n`, { mode: 0o600 })
      assert.throws(
        () =>
          writeTokenToEnvFile(env, RENEWED_TOKEN, {
            expectedCurrent: OLD_TOKEN,
            lockTimeoutMs: 300,
          }),
        (err) => {
          assert.match(err.message, /Timed out after 300 ms waiting for lock/)
          assert.ok(err.message.includes(lockFile()))
          assert.ok(err.message.includes(`held by process ${sleeper.pid}`))
          assert.ok(!SECRETS.some((secret) => err.message.includes(secret)))
          return true
        }
      )
      assert.equal(fs.readFileSync(env, 'utf8'), lines.join('\n') + '\n')
      // The live owner's lock is never removed.
      assert.equal(fs.readFileSync(lockFile(), 'utf8'), `${sleeper.pid}\n`)
    } finally {
      sleeper.kill()
    }
  })

  test('recovers from a stale lock whose process is gone', async () => {
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      { accessToken: RENEWED_TOKEN, expiresIn: 60 },
    ]
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    fs.writeFileSync(lockFile(), `${deadPid()}\n`, { mode: 0o600 })

    const result = await run('renew.mjs')

    assert.equal(result.code, 0, result.stderr)
    assert.equal(
      parseEnv(fs.readFileSync(env, 'utf8')).INFISICAL_TOKEN,
      RENEWED_TOKEN
    )
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.env'])
    assertNoSecrets(result)
  })

  test('concurrent writers never overlap, even when breaking a stale lock', async () => {
    const counter = path.join(dir, '.env')
    fs.writeFileSync(counter, '0', { mode: 0o600 })
    // Every writer starts by finding the same stale lock.
    fs.writeFileSync(lockFile(), `${deadPid()}\n`, { mode: 0o600 })
    const source = `
      import fs from 'node:fs'
      import { withEnvLock } from ${JSON.stringify(
        new URL('../infisical/common.mjs', import.meta.url).href
      )}
      const file = process.env.COUNTER
      for (let i = 0; i < 5; i++) {
        withEnvLock(file, () => {
          const value = Number(fs.readFileSync(file, 'utf8'))
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
          fs.writeFileSync(file, String(value + 1))
        })
      }
    `
    const worker = path.join(dir, 'worker.mjs')
    fs.writeFileSync(worker, source)
    const codes = await Promise.all(
      Array.from(
        { length: 6 },
        () =>
          new Promise((resolve) =>
            spawn(process.execPath, [worker], {
              env: { ...process.env, COUNTER: counter },
              stdio: 'inherit',
            }).on('exit', resolve)
          )
      )
    )
    assert.deepEqual(codes, [0, 0, 0, 0, 0, 0])
    // A lost update would mean two writers held the lock at once.
    assert.equal(fs.readFileSync(counter, 'utf8'), '30')
    assert.ok(!fs.existsSync(lockFile()))
    assert.ok(!fs.existsSync(`${lockFile()}.break`))
  })

  test('an empty lock is stale only after the grace period', () => {
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    // A fresh empty lock may belong to a process that is just creating it.
    fs.writeFileSync(lockFile(), '', { mode: 0o600 })
    assert.throws(
      () => writeTokenToEnvFile(env, NEW_TOKEN, { lockTimeoutMs: 200 }),
      /held by process unknown/
    )
    // An old one was left by a crash and is removed.
    const old = new Date(Date.now() - 60000)
    fs.utimesSync(lockFile(), old, old)
    writeTokenToEnvFile(env, NEW_TOKEN, { lockTimeoutMs: 200 })
    assert.equal(
      parseEnv(fs.readFileSync(env, 'utf8')).INFISICAL_TOKEN,
      NEW_TOKEN
    )
    assert.deepEqual(fs.readdirSync(dir), ['.env'])
  })

  test('the lock holds only the owner process ID, with mode 600', () => {
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    withEnvLock(env, () => {
      assert.equal(fs.readFileSync(lockFile(), 'utf8'), `${process.pid}\n`)
      assert.equal(modeOf(lockFile()), 0o600)
    })
    assert.ok(!fs.existsSync(lockFile()))
  })

  test('the lock is released after a failed write', async () => {
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    assert.throws(
      () =>
        withEnvLock(env, () => {
          throw new Error('write failed')
        }),
      /write failed/
    )
    assert.ok(!fs.existsSync(lockFile()))

    // It is also released when the stored token changed, and nothing is left
    // behind when a renewal receives a malformed token.
    assert.throws(() =>
      writeTokenToEnvFile(env, NEW_TOKEN, { expectedCurrent: RENEWED_TOKEN })
    )
    assert.ok(!fs.existsSync(lockFile()))
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      { accessToken: `${RENEWED_TOKEN}#x`, expiresIn: 60 },
    ]
    const result = await run('renew.mjs')
    assert.notEqual(result.code, 0)
    assert.ok(!fs.existsSync(lockFile()))
    assertNoSecrets(result)
  })
})

describe('login.mjs', () => {
  test('logs in with credentials in the body and stores the token', async () => {
    handlers['/api/v1/auth/universal-auth/login'] = () => [
      200,
      { accessToken: NEW_TOKEN, expiresIn: 2592000, tokenType: 'Bearer' },
    ]
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])

    const result = await run('login.mjs')

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(requests, [
      {
        method: 'POST',
        url: '/api/v1/auth/universal-auth/login',
        body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      },
    ])
    assert.equal(
      parseEnv(fs.readFileSync(env, 'utf8')).INFISICAL_TOKEN,
      NEW_TOKEN
    )
    assert.equal(modeOf(env), 0o600)
    assert.match(result.stdout, new RegExp(`new access token ${NEW_ID}`))
    assertNoSecrets(result)
  })

  test('appends INFISICAL_TOKEN when absent', async () => {
    handlers['/api/v1/auth/universal-auth/login'] = () => [
      200,
      { accessToken: NEW_TOKEN, expiresIn: 60 },
    ]
    const env = writeEnv('.env', baseEnv)
    const result = await run('login.mjs', ['--revoke-previous'])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(
      parseEnv(fs.readFileSync(env, 'utf8')).INFISICAL_TOKEN,
      NEW_TOKEN
    )
    assert.equal(requests.length, 1)
  })

  test('--revoke-previous revokes the old token after storing the new one', async () => {
    handlers['/api/v1/auth/universal-auth/login'] = () => [
      200,
      { accessToken: NEW_TOKEN, expiresIn: 60 },
    ]
    handlers['/api/v1/auth/token/revoke'] = () => [200, { message: 'ok' }]
    const env = writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])

    const result = await run('login.mjs', ['--revoke-previous'])

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(
      requests.map((r) => [r.url, r.body]),
      [
        [
          '/api/v1/auth/universal-auth/login',
          { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
        ],
        ['/api/v1/auth/token/revoke', { accessToken: OLD_TOKEN }],
      ]
    )
    assert.equal(
      parseEnv(fs.readFileSync(env, 'utf8')).INFISICAL_TOKEN,
      NEW_TOKEN
    )
    assert.match(
      result.stdout,
      new RegExp(`Revoked previous access token ${OLD_ID}`)
    )
    assertNoSecrets(result)
  })

  test('--revoke-previous with duplicate token lines revokes the loaded one', async () => {
    handlers['/api/v1/auth/universal-auth/login'] = () => [
      200,
      { accessToken: NEW_TOKEN, expiresIn: 60 },
    ]
    handlers['/api/v1/auth/token/revoke'] = () => [200, {}]
    const env = writeEnv('.env', [
      `INFISICAL_TOKEN=${RENEWED_TOKEN}`,
      ...baseEnv,
      `INFISICAL_TOKEN=${OLD_TOKEN}`,
    ])

    const result = await run('login.mjs', ['--revoke-previous'])

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(requests[1].body, { accessToken: OLD_TOKEN })
    const contents = fs.readFileSync(env, 'utf8')
    assert.equal(contents.match(/^INFISICAL_TOKEN=/gm).length, 1)
    assert.equal(parseEnv(contents).INFISICAL_TOKEN, NEW_TOKEN)
    assertNoSecrets(result)
  })

  test('login failure keeps .env and does not echo the client secret', async () => {
    handlers['/api/v1/auth/universal-auth/login'] = () => [
      401,
      { message: `Invalid client secret ${CLIENT_SECRET}` },
    ]
    const lines = [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`]
    const env = writeEnv('.env', lines)

    const result = await run('login.mjs')

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /HTTP 401/)
    assert.equal(fs.readFileSync(env, 'utf8'), lines.join('\n') + '\n')
    assertNoSecrets(result)
  })
})

describe('revoke.mjs', () => {
  test('revokes the backup token and verifies it is rejected', async () => {
    handlers['/api/v1/auth/token/revoke'] = () => [200, { message: 'ok' }]
    handlers['/api/v1/auth/token/renew'] = () => [401, { message: 'revoked' }]
    writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${NEW_TOKEN}`])
    writeEnv('.env.backup', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])

    const result = await run('revoke.mjs', ['.env.backup'])

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(
      requests.map((r) => [r.url, r.body]),
      [
        ['/api/v1/auth/token/revoke', { accessToken: OLD_TOKEN }],
        ['/api/v1/auth/token/renew', { accessToken: OLD_TOKEN }],
      ]
    )
    assert.match(
      result.stdout,
      new RegExp(`Verified access token ${OLD_ID} is rejected`)
    )
    assertNoSecrets(result)
  })

  test('fails if the token can still be renewed after revocation', async () => {
    handlers['/api/v1/auth/token/revoke'] = () => [200, {}]
    handlers['/api/v1/auth/token/renew'] = () => [
      200,
      { accessToken: RENEWED_TOKEN, expiresIn: 60 },
    ]
    writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${NEW_TOKEN}`])
    writeEnv('.env.backup', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])

    const result = await run('revoke.mjs', ['.env.backup'])

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /can still be renewed/)
    assertNoSecrets(result)
  })

  test('fails if the rejection cannot be verified (5xx)', async () => {
    handlers['/api/v1/auth/token/revoke'] = () => [200, {}]
    handlers['/api/v1/auth/token/renew'] = () => [503, { message: 'down' }]
    writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${NEW_TOKEN}`])
    writeEnv('.env.backup', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])

    const result = await run('revoke.mjs', ['.env.backup'])

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /could not verify the rejection.*HTTP 503/)
    assertNoSecrets(result)
  })

  test('refuses to revoke the token currently in .env', async () => {
    writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${OLD_TOKEN}`])
    writeEnv('.env.backup', [...baseEnv, `INFISICAL_TOKEN=${RENEWED_TOKEN}`])

    const result = await run('revoke.mjs', ['.env.backup'])

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /refusing to revoke the token in use/)
    assert.equal(requests.length, 0)
    assertNoSecrets(result)
  })

  test('requires a backup file argument', async () => {
    writeEnv('.env', [...baseEnv, `INFISICAL_TOKEN=${NEW_TOKEN}`])
    const result = await run('revoke.mjs')
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /Usage/)
    assert.equal(requests.length, 0)
  })
})

describe('token is never passed on the command line', () => {
  test('package.json scripts and with-infisical.sh do not use --token', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    )
    for (const [name, command] of Object.entries(pkg.scripts)) {
      assert.ok(
        !/--token|\$INFISICAL_TOKEN|--client-secret/.test(command),
        name
      )
    }
    const wrapper = fs
      .readFileSync(path.join(repoRoot, 'with-infisical.sh'), 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
    assert.ok(!/--token|INFISICAL_TOKEN/.test(wrapper))
  })

  test('token scripts do not spawn processes', () => {
    for (const name of ['common.mjs', 'renew.mjs', 'login.mjs', 'revoke.mjs']) {
      const source = fs.readFileSync(script(name), 'utf8')
      assert.ok(!/child_process|execSync|spawn\(/.test(source), name)
    }
    const renewSh = fs.readFileSync(
      path.join(repoRoot, 'infisical-renew.sh'),
      'utf8'
    )
    assert.ok(!/INFISICAL_TOKEN|token renew|sed /.test(renewSh))
  })
})
