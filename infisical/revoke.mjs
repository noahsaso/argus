// Revoke an old Infisical access token kept in a backup .env file.
//
// Usage (from the indexer directory):
//   node infisical/revoke.mjs <backup-env-file> [--env-file <path>]
//
// Reads INFISICAL_TOKEN from <backup-env-file> (for example a copy of .env
// taken before running infisical/login.mjs) and revokes it over HTTPS.
// Refuses to revoke the token currently in use in the .env file (default
// `.env`). Afterwards it checks that Infisical rejects the revoked token by
// attempting to renew it, and fails if the renewal still succeeds.
//
// Only file paths go on the command line. No token is printed; the output is
// limited to access token IDs and HTTP statuses.

import {
  TOKEN_KEY,
  accessTokenId,
  describeFailure,
  log,
  logError,
  readEnvFile,
  renewToken,
  resolveApiUrl,
  revokeToken,
} from './common.mjs'

const parseArgs = (argv) => {
  const args = { backupFile: undefined, envFile: '.env' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env-file' && argv[i + 1]) {
      args.envFile = argv[++i]
    } else if (!argv[i].startsWith('--') && !args.backupFile) {
      args.backupFile = argv[i]
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }
  if (!args.backupFile) {
    throw new Error(
      'Usage: node infisical/revoke.mjs <backup-env-file> [--env-file <path>]'
    )
  }
  return args
}

const main = async () => {
  const { backupFile, envFile } = parseArgs(process.argv.slice(2))
  const oldToken = readEnvFile(backupFile)[TOKEN_KEY]
  if (!oldToken) {
    throw new Error(`${TOKEN_KEY} is not set in ${backupFile}.`)
  }
  const currentEnv = readEnvFile(envFile)
  if (currentEnv[TOKEN_KEY] === oldToken) {
    throw new Error(
      `The token in ${backupFile} is the one currently in ${envFile}; ` +
        'refusing to revoke the token in use.'
    )
  }

  const oldId = accessTokenId(oldToken)
  const currentId = accessTokenId(currentEnv[TOKEN_KEY])
  if (oldId !== 'unknown' && oldId === currentId) {
    throw new Error(
      `The token in ${backupFile} has the same access token ID (${oldId}) ` +
        `as the token in ${envFile}; refusing to revoke the token in use.`
    )
  }

  const apiUrl = resolveApiUrl(currentEnv)
  log(`Revoking access token ${oldId}...`)
  const revoke = await revokeToken(apiUrl, oldToken)
  if (!revoke.ok) {
    throw new Error(describeFailure('Token revoke', revoke, [oldToken]))
  }
  log(`Revoked access token ${oldId} (HTTP ${revoke.status}).`)

  // Confirm Infisical now rejects the old token.
  // Only an authentication rejection proves it; a 5xx or 429 does not.
  const check = await renewToken(apiUrl, oldToken)
  if (check.ok) {
    throw new Error(
      `Access token ${oldId} can still be renewed after revocation.`
    )
  }
  if (![401, 403, 404].includes(check.status)) {
    throw new Error(
      `Revoked access token ${oldId}, but could not verify the rejection: ` +
        describeFailure('Token renew', check, [oldToken])
    )
  }
  log(
    `Verified access token ${oldId} is rejected (renew returned HTTP ${check.status}).`
  )
}

main().catch((err) => {
  logError(`Failed to revoke Infisical access token: ${err.message}`)
  process.exit(1)
})
