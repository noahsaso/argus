/**
 * Helpers for classifying and backing off from transient RPC errors.
 */

/**
 * Messages that mean the block exists or will exist soon, but the RPC node has
 * not caught up yet. These are expected at the chain tip.
 */
const PENDING_BLOCK_MESSAGES = [
  'must be less than or equal to the current blockchain height',
]

/**
 * Messages that mean the RPC node or the network between us and it is
 * temporarily unable to answer. Compared case-insensitively.
 */
const TRANSIENT_MESSAGES = [
  // The node has committed the block but has not stored its results yet, or a
  // load balancer routed the request to a node that is behind.
  'could not find results for height',
  // Timeouts.
  'timeout',
  'timed out',
  // Connection resets and other network failures.
  'socket hang up',
  'network error',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'etimedout',
  'esockettimedout',
  'eai_again',
  'epipe',
  'und_err_socket',
  'und_err_connect_timeout',
  'und_err_headers_timeout',
  'und_err_body_timeout',
]

/**
 * Messages that are transient only as the whole message, because they are
 * common substrings of unrelated errors. Compared case-insensitively.
 */
const EXACT_TRANSIENT_MESSAGES = [
  // Node's built-in fetch (undici) wraps network failures in this error.
  'fetch failed',
]

/**
 * HTTP 5xx status codes in the messages produced by the HTTP clients we use:
 * - @cosmjs/tendermint-rpc: "Bad status on response: 502"
 * - axios: "Request failed with status code 503"
 */
const HTTP_5XX_PATTERNS = [
  /bad status on response:\s*5\d\d/i,
  /status code\s*5\d\d/i,
]

/**
 * Collect the messages and codes of an error and its causes, so wrapped errors
 * are classified by their underlying cause.
 */
const getErrorStrings = (error: unknown, depth = 0): string[] => {
  if (error === null || error === undefined || depth > 5) {
    return []
  }

  if (typeof error !== 'object') {
    return [String(error)]
  }

  const strings: string[] = []
  const { message, code, cause } = error as {
    message?: unknown
    code?: unknown
    cause?: unknown
  }
  if (typeof message === 'string') {
    strings.push(message)
  }
  if (typeof code === 'string') {
    strings.push(code)
  }
  if (!strings.length) {
    strings.push(String(error))
  }

  return [...strings, ...getErrorStrings(cause, depth + 1)]
}

export enum RpcErrorKind {
  /**
   * The requested block is above the node's current height. Wait for it to be
   * committed.
   */
  Pending = 'pending',
  /**
   * The node or network is temporarily unable to answer. Retry with backoff.
   */
  Transient = 'transient',
  /**
   * Anything else. Callers keep their normal error handling.
   */
  Other = 'other',
}

/**
 * Classify an RPC error as pending, transient or other.
 */
export const classifyRpcError = (error: unknown): RpcErrorKind => {
  const strings = getErrorStrings(error).map((s) => s.toLowerCase())

  if (strings.some((s) => PENDING_BLOCK_MESSAGES.some((m) => s.includes(m)))) {
    return RpcErrorKind.Pending
  }

  if (
    strings.some(
      (s) =>
        TRANSIENT_MESSAGES.some((m) => s.includes(m)) ||
        EXACT_TRANSIENT_MESSAGES.includes(s.trim()) ||
        HTTP_5XX_PATTERNS.some((p) => p.test(s))
    )
  ) {
    return RpcErrorKind.Transient
  }

  return RpcErrorKind.Other
}

/**
 * Whether or not an RPC error is transient and worth retrying with backoff.
 * Pending-block errors count as transient.
 */
export const isTransientRpcError = (error: unknown): boolean =>
  classifyRpcError(error) !== RpcErrorKind.Other

export type BackoffOptions = {
  /**
   * Delay before the first retry. Default 1 second.
   */
  initialDelayMs?: number
  /**
   * Maximum delay between retries. Default 30 seconds.
   */
  maxDelayMs?: number
}

/**
 * Exponential backoff delay for a 1-indexed retry attempt, capped at
 * `maxDelayMs`.
 */
export const getBackoffDelayMs = (
  attempt: number,
  { initialDelayMs = 1_000, maxDelayMs = 30_000 }: BackoffOptions = {}
): number =>
  Math.min(
    maxDelayMs,
    initialDelayMs * 2 ** Math.min(Math.max(attempt - 1, 0), 30)
  )
