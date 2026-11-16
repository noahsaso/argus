// Shared helpers for the Infisical token scripts in this directory (renew, login, revoke).
//
// Security rules these helpers exist to enforce:
// - Tokens and client secrets are only ever read from a .env file (or the
//   process environment) and sent in HTTPS request bodies. They are never put
//   on a command line, so they never appear in /proc/<pid>/cmdline or `ps`.
// - Nothing logged by these scripts contains a token or client secret. Logs
//   show only HTTP statuses, access token IDs and expiry times, and every
//   message that includes external text passes through `redact` first.
// - The .env file is rewritten atomically: a new file is created with mode
//   600, fsynced and renamed over the old one, so a crash never leaves a
//   truncated .env and the token is never readable by other users.
//
// Plain Node (18 or newer, for global fetch). No dependencies.

import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_API_URL = 'https://app.infisical.com/api'
export const TOKEN_KEY = 'INFISICAL_TOKEN'

const JWT_PATTERN = /ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/**
 * Parse the contents of a .env file into an object, following dotenv's rules
 * for the cases that matter here: `KEY=value`, optional `export ` prefixes,
 * full-line comments, single or double quoted values, inline `#` comments
 * after unquoted values, and the LAST occurrence of a key winning.
 */
export const parseEnv = (contents) => {
  const env = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!match) {
      continue
    }
    let value = match[2].trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) {
      value = value.slice(1, value.indexOf(quote, 1))
    } else {
      // Unquoted values end at the first `#`, as in dotenv.
      value = value.split('#')[0].trim()
    }
    env[match[1]] = value
  }
  return env
}

/** Read and parse a .env file. */
export const readEnvFile = (envPath) =>
  parseEnv(fs.readFileSync(envPath, 'utf8'))

/**
 * Return `contents` with `key` set to `value`. The first line for `key` is
 * replaced and any later duplicate lines for it are removed, so exactly one
 * line remains (dotenv uses the last occurrence, so leaving a stale duplicate
 * would silently override the new value). Every other line is kept in order.
 * Appends the key if it is missing.
 */
export const setEnvValue = (contents, key, value) => {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`)
  let found = false
  const updated = []
  for (const line of contents.split('\n')) {
    if (pattern.test(line)) {
      if (!found) {
        updated.push(`${key}=${value}`)
        found = true
      }
      continue
    }
    updated.push(line)
  }
  if (!found) {
    if (updated.length > 0 && updated[updated.length - 1] === '') {
      updated.splice(updated.length - 1, 0, `${key}=${value}`)
    } else {
      updated.push(`${key}=${value}`)
    }
  }
  return updated.join('\n')
}

/**
 * Atomically write `contents` to `filePath` with mode 600: write a temporary
 * file in the same directory (created with mode 600), fsync it, rename it over
 * the target and fsync the directory.
 */
export const writeFileAtomic = (filePath, contents) => {
  const dir = path.dirname(path.resolve(filePath))
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`
  )
  let fd
  try {
    // 'wx' fails if the file exists, so the mode 600 below always applies.
    fd = fs.openSync(tmpPath, 'wx', 0o600)
    fs.fchmodSync(fd, 0o600)
    fs.writeSync(fd, contents)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    if (fd !== undefined) {
      fs.closeSync(fd)
    }
    fs.rmSync(tmpPath, { force: true })
    throw err
  }
  try {
    const dirFd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(dirFd)
    } finally {
      fs.closeSync(dirFd)
    }
  } catch {
    // Directory fsync is best effort (not supported on every platform).
  }
}

/** Atomically replace INFISICAL_TOKEN in the .env file at `envPath`. */
export const writeTokenToEnvFile = (envPath, token) => {
  // Access tokens are JWTs: base64url segments separated by dots.
  if (!token || !/^[A-Za-z0-9._-]+$/.test(token)) {
    throw new Error('Refusing to write an empty or malformed token.')
  }
  const updated = setEnvValue(
    fs.readFileSync(envPath, 'utf8'),
    TOKEN_KEY,
    token
  )
  // Make sure the value that dotenv will load is the one just written.
  if (parseEnv(updated)[TOKEN_KEY] !== token) {
    throw new Error(
      `Refusing to write ${envPath}: ${TOKEN_KEY} would not read back as the new token.`
    )
  }
  writeFileAtomic(envPath, updated)
}

/**
 * Replace anything that looks like a JWT, and every given secret value, with
 * a placeholder. Used on all external text before it is logged.
 */
export const redact = (text, secrets = []) => {
  let result = String(text).replace(JWT_PATTERN, '[REDACTED]')
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      result = result.split(secret).join('[REDACTED]')
    }
  }
  return result
}

/**
 * Return the non-secret access token ID from an Infisical access token JWT
 * payload, or 'unknown'. The signature is not verified (not needed here).
 */
export const accessTokenId = (token) => {
  try {
    const payload = JSON.parse(
      Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')
    )
    const id = payload.identityAccessTokenId ?? payload.jti
    return typeof id === 'string' && /^[A-Za-z0-9-]+$/.test(id) ? id : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Format an `expiresIn` value in seconds as an ISO timestamp. */
export const expiryFromNow = (expiresIn) =>
  typeof expiresIn === 'number' && Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : 'unknown'

/**
 * Resolve the Infisical API base URL (including the `/api` suffix, matching
 * the Infisical CLI's INFISICAL_API_URL convention). The process environment
 * wins over the .env file.
 */
export const resolveApiUrl = (env = {}) =>
  (
    process.env.INFISICAL_API_URL ||
    env.INFISICAL_API_URL ||
    DEFAULT_API_URL
  ).replace(/\/+$/, '')

/**
 * POST a JSON body to `${apiUrl}${route}`. Returns `{ ok, status, body }`,
 * where `body` is the parsed JSON response (or undefined). Secrets travel
 * only in the request body. Network errors are rethrown with a redacted
 * message.
 */
export const postJson = async (apiUrl, route, payload, secrets = []) => {
  let response
  try {
    response = await fetch(`${apiUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw new Error(
      `Request to ${route} failed: ${redact(err?.message ?? err, secrets)}`
    )
  }
  let body
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  return { ok: response.ok, status: response.status, body }
}

/** Describe a failed API response without exposing secrets. */
export const describeFailure = (route, result, secrets = []) => {
  const message =
    result.body && typeof result.body.message === 'string'
      ? `: ${redact(result.body.message, secrets)}`
      : ''
  return `${route} returned HTTP ${result.status}${message}`
}

/** Renew an access token. Returns the API response. */
export const renewToken = (apiUrl, accessToken) =>
  postJson(apiUrl, '/v1/auth/token/renew', { accessToken }, [accessToken])

/** Revoke an access token. Returns the API response. */
export const revokeToken = (apiUrl, accessToken) =>
  postJson(apiUrl, '/v1/auth/token/revoke', { accessToken }, [accessToken])

/** Log in with universal auth. Returns the API response. */
export const universalAuthLogin = (apiUrl, clientId, clientSecret) =>
  postJson(
    apiUrl,
    '/v1/auth/universal-auth/login',
    { clientId, clientSecret },
    [clientId, clientSecret]
  )

/** Timestamped log line on stdout. */
export const log = (message) =>
  console.log(`[${new Date().toISOString()}] ${message}`)

/** Timestamped log line on stderr. */
export const logError = (message) =>
  console.error(`[${new Date().toISOString()}] ${message}`)
