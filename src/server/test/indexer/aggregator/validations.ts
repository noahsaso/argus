import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { app } from '../app'
import { AggregatorTestOptions } from './types'

export const loadValidationsTests = (options: AggregatorTestOptions) => {
  describe('validations', () => {
    it('returns 400 if aggregator name is missing', async () => {
      await request(app.callback())
        .get('/a/')
        .set('x-api-key', options.apiKey)
        .expect(400)
        .expect('missing required parameters')
    })

    it('returns 404 if aggregator does not exist', async () => {
      options.mockAggregator()
      await request(app.callback())
        .get('/a/invalid')
        .set('x-api-key', options.apiKey)
        .expect(404)
        .expect('aggregator not found')
    })

    it('returns 401 if API key is invalid', async () => {
      await request(app.callback())
        .get('/a/balance/overTime')
        .set('x-api-key', 'invalid')
        .expect(401)
        .expect('invalid API key')
    })

    it('supports API key in URL path', async () => {
      options.mockAggregator()
      const response = await request(app.callback()).get(
        `/a/${options.apiKey}/balance/overTime`
      )
      expect(response.status).not.toBe(401)
    })

    it('supports API key in header', async () => {
      options.mockAggregator()
      const response = await request(app.callback())
        .get('/a/balance/overTime')
        .set('x-api-key', options.apiKey)
      expect(response.status).not.toBe(401)
    })
  })
}
