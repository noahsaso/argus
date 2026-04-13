import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { app } from './app'

describe('health', () => {
  it('returns ok', async () => {
    await request(app.callback())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok')
        expect(res.body.version).toBeTypeOf('string')
        expect(res.body.timestamp).toBeTypeOf('string')
      })
  })
})
