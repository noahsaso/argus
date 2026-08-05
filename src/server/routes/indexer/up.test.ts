import { describe, expect, it } from 'vitest'

import { isIndexerCaughtUp } from './up'

describe('isIndexerCaughtUp', () => {
  it('reports a stale exporter even when the local RPC is current', () => {
    expect(
      isIndexerCaughtUp({
        remoteHeight: 40_483_940,
        localHeight: 40_483_940,
        exportedHeight: 40_420_068,
      })
    ).toBe(false)
  })

  it('reports an exporter fewer than five blocks behind as caught up', () => {
    expect(
      isIndexerCaughtUp({
        remoteHeight: 40_483_940,
        exportedHeight: 40_483_938,
      })
    ).toBe(true)
  })

  it('preserves the strict five-block boundary', () => {
    expect(isIndexerCaughtUp({ remoteHeight: 100, exportedHeight: 95 })).toBe(
      false
    )
    expect(isIndexerCaughtUp({ remoteHeight: 100, exportedHeight: 96 })).toBe(
      true
    )
  })
})
