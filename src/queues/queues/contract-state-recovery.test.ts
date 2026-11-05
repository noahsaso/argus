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

  it('skips jobs for contracts excluded by config without touching RPC', async () => {
    const queue = new ContractStateRecoveryQueue({
      config: {
        remoteRpc: '',
        excludedContractAddresses: ['juno1contract'],
      },
    } as any)
    const log = vi.fn()

    // An empty remoteRpc would throw if processing continued past the check.
    await expect(
      queue.process({
        data: { address: 'juno1contract', detectedBlockHeight: '123' },
        log,
      } as any)
    ).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('excluded by excludedContractAddresses')
    )
  })
})
