import Redis, { RedisOptions } from 'ioredis'

import { ConfigManager } from './manager'

export const getRedisConfig = (): RedisOptions | undefined => {
  const { redis } = ConfigManager.load()
  return (
    redis && {
      host: redis.host,
      port: redis.port ? Number(redis.port) : undefined,
      username: redis.username,
      password: redis.password,
      keyPrefix: redis.keyPrefix,
      // Empty object is used to enable TLS. Optionally allow TLS options.
      tls:
        redis.tls === true || redis.tls === 'true' || redis.tls === '1'
          ? {}
          : redis.tls && typeof redis.tls === 'object'
          ? redis.tls
          : undefined,
    }
  )
}

export const getRedis = (options?: RedisOptions): Redis => {
  const config = getRedisConfig()
  if (!config) {
    throw new Error('Redis config not found')
  }

  return new Redis({
    ...config,
    ...options,
  })
}

/**
 * Test the connection to Redis.
 */
export const testRedisConnection = async (
  /**
   * If true, throw error if the connection fails instead of returning false.
   */
  throwError = false
): Promise<boolean> => {
  const config = getRedisConfig()
  if (!config) {
    return false
  }

  try {
    const redis = new Redis({
      ...config,
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
      commandTimeout: 5_000,
    })
    // Do nothing on error (to avoid spamming logs).
    redis.on('error', () => {})
    await redis.ping()
    await redis.quit()

    return true
  } catch (err) {
    if (throwError) {
      throw err
    }

    if (
      err instanceof Error &&
      (err.message.includes('maxRetriesPerRequest') ||
        err.message.includes('ENOTFOUND') ||
        err.message.includes('ECONNREFUSED'))
    ) {
      return false
    }

    console.error('Error connecting to Redis:', err)
    return false
  }
}
