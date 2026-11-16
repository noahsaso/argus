// Renew the Infisical access token stored in .env.
//
// Usage (from the indexer directory, as the PM2 `renew-infisical-token` app
// does every day): node infisical/renew.mjs [--env-file <path>]
//
// Reads INFISICAL_TOKEN from the .env file, renews it over HTTPS and writes
// the renewed token back into the .env file atomically with mode 600. The
// token never appears on a command line or in the output; only the HTTP
// status, the access token ID and the new expiry are logged. Exits non-zero
// on failure, leaving the .env file unchanged.

import {
  TOKEN_KEY,
  accessTokenId,
  describeFailure,
  expiryFromNow,
  log,
  logError,
  readEnvFile,
  renewToken,
  resolveApiUrl,
  writeTokenToEnvFile,
} from './common.mjs'

const parseArgs = (argv) => {
  const args = { envFile: '.env' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env-file' && argv[i + 1]) {
      args.envFile = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }
  return args
}

const main = async () => {
  const { envFile } = parseArgs(process.argv.slice(2))
  const env = readEnvFile(envFile)
  const token = env[TOKEN_KEY]
  if (!token) {
    throw new Error(`${TOKEN_KEY} is not set in ${envFile}.`)
  }

  log(`Renewing Infisical access token ${accessTokenId(token)}...`)
  const result = await renewToken(resolveApiUrl(env), token)
  if (!result.ok || typeof result.body?.accessToken !== 'string') {
    throw new Error(
      result.ok
        ? 'Renew response did not contain an access token.'
        : describeFailure('Token renew', result, [token])
    )
  }

  writeTokenToEnvFile(envFile, result.body.accessToken)
  log(
    `Renewed access token ${accessTokenId(result.body.accessToken)} ` +
      `(HTTP ${result.status}), expires ${expiryFromNow(
        result.body.expiresIn
      )}.`
  )
}

main().catch((err) => {
  logError(`Failed to renew Infisical access token: ${err.message}`)
  process.exit(1)
})
