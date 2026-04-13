import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { version } from '@/version'

import { app } from './app'

describe('version in responses', () => {
  it('/health includes version', async () => {
    await request(app.callback())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.version).toBe(version)
      })
  })

  it('/status includes version', async () => {
    await request(app.callback())
      .get('/status')
      .expect(200)
      .expect((res) => {
        expect(res.body.version).toBe(version)
      })
  })
})
