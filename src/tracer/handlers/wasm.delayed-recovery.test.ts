import { describe, expect, it, vi } from 'vitest'

import { scheduleDelayedContractStateRecoveries } from './wasm'

describe('scheduleDelayedContractStateRecoveries', () => {
  it('schedules delayed recovery for each newly detected contract', async () => {
    const addDelayed = vi.fn().mockResolvedValue(undefined)

    await scheduleDelayedContractStateRecoveries(
      [
        { address: 'juno1contract', blockHeight: '123' },
        { address: 'juno1other', blockHeight: '124' },
      ],
      addDelayed
    )

    expect(addDelayed).toHaveBeenCalledTimes(2)
    expect(addDelayed).toHaveBeenNthCalledWith(1, {
      address: 'juno1contract',
      detectedBlockHeight: '123',
    })
    expect(addDelayed).toHaveBeenNthCalledWith(2, {
      address: 'juno1other',
      detectedBlockHeight: '124',
    })
  })
})
