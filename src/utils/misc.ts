export const bigIntMax = (...args: bigint[]) =>
  args.reduce((m, e) => (e > m ? e : m))

export const bigIntMin = (...args: bigint[]) =>
  args.reduce((m, e) => (e < m ? e : m))

/**
 * Attempt to execute `callback` `tries` times and return the result on success
 * or throw the last error. If `delayMs` is provided, wait `delayMs` between
 * attempts.
 *
 * @param tries Number of times to attempt to execute the callback.
 * @param callback Function to execute. It will be passed a `bail` function that
 * can be used to bail out of the retry loop.
 * @param delayMs Number of milliseconds to wait between attempts.
 * @param rateLimitDelayMs Number of milliseconds to wait if the error is a rate
 * limit / too many requests (429) error. Defaults to 10,000 (10s). Rate limits
 * do not count towards the `tries` limit.
 * @returns Result of the callback.
 */
export const retry = async <T extends unknown>(
  tries: number,
  callback: (
    attempt: number,
    bail: (error?: Error | string) => void
  ) => T | Promise<T>,
  delayMs?: number,
  rateLimitDelayMs: number = 10_000
): Promise<T> => {
  let attempt = 1

  const bail = (error: Error | string = 'Bailed out of retry loop') => {
    attempt = tries
    throw typeof error === 'string' ? new Error(error) : error
  }

  while (true) {
    try {
      return await callback(attempt, bail)
    } catch (err) {
      const message = (
        err instanceof Error ? err.message : String(err)
      ).toLowerCase()
      const isRateLimit =
        message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('rate limit exceeded')
      if (isRateLimit) {
        await new Promise((resolve) => setTimeout(resolve, rateLimitDelayMs))
        continue
      }

      attempt++
      if (attempt > tries) {
        throw err
      }

      if (delayMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
}

/**
 * Perform a task on each item in a list in batches of `batchSize`. Optionally
 * retry the task up to `tries` times with a delay of `delayMs` between each
 * attempt.
 *
 * @param list List of items to process.
 * @param grouped Whether to group the items into batches. Defaults to false.
 * @param task Function to execute for each item when grouped is false, or for
 * each batch when grouped is true.
 * @param batchSize Size of each batch.
 * @param tries Number of times to retry the task.
 * @param delayMs Number of milliseconds to wait between retries.
 * @returns Result of the callback.
 */
export const batch = async <T extends unknown>({
  list,
  batchSize,
  tries,
  delayMs,
  ...args
}: {
  list: readonly T[] | T[]
  batchSize: number
  tries?: number
  delayMs?: number
} & (
  | {
      grouped?: false
      task: (item: T, attempt: number, index: number) => Promise<any>
    }
  | {
      grouped: true
      task: (items: T[], attempt: number, index: number) => Promise<any>
    }
)): Promise<void> => {
  for (let i = 0; i < list.length; i += batchSize) {
    const items = list.slice(i, i + batchSize)
    if (args.grouped) {
      const index = i / batchSize
      await (tries
        ? retry(tries, (attempt) => args.task(items, attempt, index), delayMs)
        : args.task(items, 1, index))
    } else {
      await Promise.all(
        items.map((item, index) =>
          tries
            ? retry(
                tries,
                (attempt) => args.task(item, attempt, index),
                delayMs
              )
            : args.task(item, 1, index)
        )
      )
    }
  }
}

/**
 * Whether or not the error object or message contains a substring.
 * @param error Error object.
 * @param substring Substring to check for.
 * @returns Whether or not the error contains the substring.
 */
export const errorMessageContains = (error: unknown, substring: string) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(substring)
}
