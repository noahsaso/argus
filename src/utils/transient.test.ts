import { describe, expect, it } from 'vitest'

import {
  RpcErrorKind,
  classifyRpcError,
  getBackoffDelayMs,
  isTransientRpcError,
} from './transient'

describe('classifyRpcError', () => {
  it('classifies a block above the node height as pending', () => {
    expect(
      classifyRpcError(
        new Error(
          'height 101 must be less than or equal to the current blockchain height 100'
        )
      )
    ).toBe(RpcErrorKind.Pending)
  })

  it.each([
    // The xion-mainnet crash on 2026-11-20.
    '{"code":-32603,"message":"Internal error","data":"could not find results for height #25698880"}',
    // The xion-testnet crash on 2026-11-15.
    'Bad status on response: 502',
    'Bad status on response: 503',
    'Bad status on response: 504',
    'Bad status on response: 500',
    'Request failed with status code 502',
    'timeout of 30000ms exceeded',
    'Request timed out',
    'socket hang up',
    'fetch failed',
    'connect ECONNREFUSED 127.0.0.1:26657',
    'read ECONNRESET',
    'connect ETIMEDOUT 1.2.3.4:443',
    'getaddrinfo EAI_AGAIN rpc.example.com',
  ])('classifies "%s" as transient', (message) => {
    expect(classifyRpcError(new Error(message))).toBe(RpcErrorKind.Transient)
    expect(isTransientRpcError(new Error(message))).toBe(true)
  })

  it.each([
    'Bad status on response: 400',
    'Bad status on response: 404',
    'Block fetch failed',
    'invalid block',
    'TX decoding failed',
    'height 1 is not available, lowest height is 9675000',
    'CosmWasm client not connected',
  ])('classifies "%s" as other', (message) => {
    expect(classifyRpcError(new Error(message))).toBe(RpcErrorKind.Other)
    expect(isTransientRpcError(new Error(message))).toBe(false)
  })

  it('uses the error code', () => {
    const error = Object.assign(new Error('request failed'), {
      code: 'ECONNRESET',
    })
    expect(classifyRpcError(error)).toBe(RpcErrorKind.Transient)
  })

  it('uses the error cause', () => {
    expect(
      classifyRpcError(
        new Error('CosmWasm client not connected', {
          cause: new Error('Bad status on response: 502'),
        })
      )
    ).toBe(RpcErrorKind.Transient)
    expect(
      classifyRpcError(
        new Error('CosmWasm client not connected', {
          cause: new Error('Bad status on response: 401'),
        })
      )
    ).toBe(RpcErrorKind.Other)
  })

  it('handles non-error values', () => {
    expect(classifyRpcError('Bad status on response: 502')).toBe(
      RpcErrorKind.Transient
    )
    expect(classifyRpcError(undefined)).toBe(RpcErrorKind.Other)
    expect(classifyRpcError(null)).toBe(RpcErrorKind.Other)
  })
})

describe('getBackoffDelayMs', () => {
  it('doubles from the initial delay and caps at the maximum', () => {
    const options = { initialDelayMs: 1_000, maxDelayMs: 30_000 }
    expect(
      [1, 2, 3, 4, 5, 6, 7, 100].map((attempt) =>
        getBackoffDelayMs(attempt, options)
      )
    ).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000])
  })

  it('defaults to 1 second doubling up to 30 seconds', () => {
    expect(getBackoffDelayMs(1)).toBe(1_000)
    expect(getBackoffDelayMs(20)).toBe(30_000)
  })
})
