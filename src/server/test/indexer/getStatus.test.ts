import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { State } from '@/db'
import { serializeBlock } from '@/utils'
import { version } from '@/version'

import { app } from './app'

describe('GET /status', () => {
  it('returns the status', async () => {
    const state = (await State.getSingleton())!
    expect(state).toBeDefined()

    await request(app.callback())
      .get('/status')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect({
        version,
        chainId: state.chainId,
        latestBlock: serializeBlock(state.latestBlock),
        lastStakingBlockHeightExported:
          state.lastStakingBlockHeightExported?.toString() || null,
        lastWasmBlockHeightExported:
          state.lastWasmBlockHeightExported?.toString() || null,
        lastBankBlockHeightExported:
          state.lastBankBlockHeightExported?.toString() || null,
        lastGovBlockHeightExported:
          state.lastGovBlockHeightExported?.toString() || null,
        lastDistributionBlockHeightExported:
          state.lastDistributionBlockHeightExported?.toString() || null,
      })
  })
})
