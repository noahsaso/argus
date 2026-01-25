import { randomUUID } from 'crypto'

import cors from '@koa/cors'
import * as Sentry from '@sentry/node'
import { Command } from 'commander'
import Koa from 'koa'
import { Pool } from 'sequelize-pool'

import { ConfigManager } from '@/config'
import { closeDb, loadDb } from '@/db'
import { WasmCodeService } from '@/services/wasm-codes'
import { DbType } from '@/types'

import { setUpRouter } from './routes'
import { captureSentryException } from './sentry'

// Parse arguments.
const program = new Command()
program.option('-p, --port <port>', 'port to listen on', '3420')
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.option('-a, --accounts', 'run account server instead of indexer server')
program.parse()
const options = program.opts()

// Load config from specific config file.
const config = ConfigManager.load(options.config)

const accounts = !!options.accounts

// Setup app.
const app = new Koa()

// Add Sentry error reporting.
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    // Don't send these to Sentry as we don't need to be notified for them or
    // they are spam and waste our quota.
    ignoreErrors: ['BadRequestError'],
  })
}

app.on('error', (err, ctx) => {
  console.error('Caught top-level error:', err)

  // Sentry error handler.
  if (config.sentryDsn) {
    captureSentryException(ctx, err)
  }
})

// Use CORS on all routes.
app.use(cors())

// Logger.
app.use(async (ctx, next) => {
  const id = randomUUID()
  console.log(`[${id}] ${ctx.method} ${ctx.url} @ ${new Date().toISOString()}`)

  await next()

  const rt = ctx.response.get('X-Response-Time')
  console.log(`[${id}] ${ctx.method} ${ctx.url} - ${ctx.status} - ${rt}`)
})

// Add X-Response-Time header.
app.use(async (ctx, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  ctx.set('X-Response-Time', `${ms}ms`)
})

let wasmCodeService: WasmCodeService | null = null
let connectionPoolMonitorInterval: NodeJS.Timeout | null = null

// Start.
const main = async () => {
  // All servers need to connect to the accounts DB.
  let sequelize = await loadDb({
    type: DbType.Accounts,
  })

  // Only connect to data if we're not serving the accounts API (i.e. we're
  // serving indexer data).
  if (!accounts) {
    sequelize = await loadDb({
      type: DbType.Data,
    })

    // Set up wasm code service.
    wasmCodeService = await WasmCodeService.setUpInstance({
      withUpdater: true,
    })
  }

  if (!options.port || isNaN(options.port)) {
    throw new Error('Port must be a number')
  }

  // Monitor DB connection pool.
  connectionPoolMonitorInterval = setInterval(async () => {
    const pool = (sequelize.connectionManager as any).pool as Pool<any>

    console.log('DATABASE CONNECTION POOL:', {
      total: pool.size,
      active: pool.using,
      idle: pool.available,
      waiting: pool.waiting,
    })

    if (pool.waiting > 0) {
      console.log(`${pool.waiting} connections waiting for pool...`)
    }
  }, 30_000)

  // Set up routes.
  await setUpRouter(app, {
    config,
    accounts,
  })

  app.listen(options.port, () => {
    console.log(`Listening on ${options.port}...`)

    // Tell pm2 we're ready.
    if (process.send) {
      process.send('ready')
    }
  })
}

// On exit, stop services and close DB connection.
const cleanUp = async () => {
  if (connectionPoolMonitorInterval !== null) {
    clearInterval(connectionPoolMonitorInterval)
    connectionPoolMonitorInterval = null
  }

  if (wasmCodeService) {
    wasmCodeService.stopUpdater()
  }

  await closeDb().catch((err) => {
    console.error('Error closing DB:', err)
  })
}

main().catch((err) => {
  console.error('Main error:', err)
  process.exit(1)
})

process.on('exit', async (code) => {
  console.log(`Exiting due to ${code}...`)
  await cleanUp()
})

// Clean up by calling exit.
process.on('SIGINT', async () => {
  console.log('SIGINT received.')
  process.exit()
})
process.on('SIGTERM', async () => {
  console.log('SIGTERM received.')
  process.exit()
})
process.on('SIGUSR1', async () => {
  console.log('SIGUSR1 received.')
  process.exit()
})
process.on('SIGUSR2', async () => {
  console.log('SIGUSR2 received.')
  process.exit()
})
