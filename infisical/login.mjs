// Log in to Infisical with universal auth and store a new access token in .env.
//
// Usage (from the indexer directory):
//   node infisical/login.mjs [--env-file <path>] [--revoke-previous]
//
// Reads the client ID and client secret from the .env file
// (INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET, or the Infisical CLI names
// INFISICAL_UNIVERSAL_AUTH_CLIENT_ID and INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET),
// logs in over HTTPS and writes the new token into the .env file as
// INFISICAL_TOKEN, atomically with mode 600, while holding the token lock file
// (<env>.lock) that renew.mjs also uses, so a renewal running at the same time
// cannot overwrite the new token.
//
// With --revoke-previous, the token that was in the .env file before the login
// is revoked afterwards (use only when nothing still needs the old token).
//
// No token or client secret ever appears on a command line or in the output;
// only the access token IDs and the new expiry are printed.

import {
  TOKEN_KEY,
  accessTokenId,
  describeFailure,
  expiryFromNow,
  log,
  logError,
  readEnvFile,
  resolveApiUrl,
  revokeToken,
  universalAuthLogin,
  writeTokenToEnvFile,
} from './common.mjs'

const parseArgs = (argv) => {
  const args = { envFile: '.env', revokePrevious: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env-file' && argv[i + 1]) {
      args.envFile = argv[++i]
    } else if (argv[i] === '--revoke-previous') {
      args.revokePrevious = true
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }
  return args
}

const main = async () => {
  const { envFile, revokePrevious } = parseArgs(process.argv.slice(2))
  const env = readEnvFile(envFile)
  const clientId =
    env.INFISICAL_CLIENT_ID || env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID
  const clientSecret =
    env.INFISICAL_CLIENT_SECRET || env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      `INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET must be set in ${envFile}.`
    )
  }
  const previousToken = env[TOKEN_KEY]
  const apiUrl = resolveApiUrl(env)

  log('Logging in to Infisical with universal auth...')
  const result = await universalAuthLogin(apiUrl, clientId, clientSecret)
  if (!result.ok || typeof result.body?.accessToken !== 'string') {
    throw new Error(
      result.ok
        ? 'Login response did not contain an access token.'
        : describeFailure('Universal auth login', result, [
            clientId,
            clientSecret,
          ])
    )
  }

  const newToken = result.body.accessToken
  writeTokenToEnvFile(envFile, newToken)
  log(
    `Stored new access token ${accessTokenId(newToken)} in ${envFile}, ` +
      `expires ${expiryFromNow(result.body.expiresIn)}.`
  )

  if (!revokePrevious) {
    return
  }
  if (!previousToken) {
    log(`No previous ${TOKEN_KEY} in ${envFile}; nothing to revoke.`)
    return
  }
  if (previousToken === newToken) {
    throw new Error('Previous token equals the new token; not revoking it.')
  }

  const previousId = accessTokenId(previousToken)
  const revoke = await revokeToken(apiUrl, previousToken)
  if (!revoke.ok) {
    throw new Error(
      `The new token is stored, but revoking previous access token ` +
        `${previousId} failed: ` +
        describeFailure('Token revoke', revoke, [previousToken])
    )
  }
  log(`Revoked previous access token ${previousId} (HTTP ${revoke.status}).`)
}

main().catch((err) => {
  logError(`Infisical login failed: ${err.message}`)
  process.exit(1)
})
