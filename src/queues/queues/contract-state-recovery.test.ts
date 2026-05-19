import { describe, expect, it, vi } from 'vitest'

import {
  CONTRACT_STATE_RECOVERY_DELAY_MS,
  ContractStateRecoveryQueue,
} from './contract-state-recovery'

describe('ContractStateRecoveryQueue', () => {
  it('adds delayed recovery jobs with a dedupe job id', async () => {
    const add = vi
      .spyOn(ContractStateRecoveryQueue, 'add')
      .mockResolvedValue({} as any)

    await ContractStateRecoveryQueue.addDelayed({
      address: 'juno1contract',
      detectedBlockHeight: '123',
    })

    expect(add).toHaveBeenCalledWith(
      'juno1contract:123',
      {
        address: 'juno1contract',
        detectedBlockHeight: '123',
        rpc: 'remote',
      },
      {
        delay: CONTRACT_STATE_RECOVERY_DELAY_MS,
        jobId: 'juno1contract:123',
      }
    )
  })
})
