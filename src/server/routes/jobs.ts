import Koa from 'koa'
import auth from 'koa-basic-auth'
import mount from 'koa-mount'

import { testRedisConnection } from '@/config/redis'
import { Config } from '@/types'

import { makeBullBoardJobsMiddleware } from './indexer/bull'

export const setUpBullBoard = async (
  app: Koa,
  { exporterDashboardPassword }: Config
) => {
  const setUpBullBoard = async () => {
    const bullApp = new Koa()

    bullApp.use(
      auth({
        name: 'exporter',
        pass: exporterDashboardPassword || 'exporter',
      })
    )

    bullApp.use(makeBullBoardJobsMiddleware('/jobs'))

    app.use(mount('/jobs', bullApp))
  }

  // Test redis connection before mounting the bull board.
  if (await testRedisConnection()) {
    await setUpBullBoard()
  }
  // If connection fails, add placeholder route that attempts to connect to
  // redis and re-mount the bull board.
  else {
    console.error('REDIS CONNECTION FAILED, BULL BOARD NOT CONNECTED\n')

    const placeholderRoute = mount('/jobs', async (ctx) => {
      try {
        if (await testRedisConnection(true)) {
          // Remove this placeholder route.
          const index = app.middleware.indexOf(placeholderRoute)
          if (index !== -1) {
            app.middleware.splice(index, 1)
          }

          // Mount the bull board.
          await setUpBullBoard()
        }
      } catch (err) {
        ctx.status = 500
        ctx.body = `Redis connection failed: ${
          err instanceof Error ? err.message : `${err}`
        }`
      }
    })

    app.use(placeholderRoute)
  }
}
