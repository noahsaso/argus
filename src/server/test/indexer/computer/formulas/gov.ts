import request from 'supertest'
import { beforeEach, describe, it } from 'vitest'

import { Block, GovProposal, GovProposalVote, State } from '@/db'

import { app } from '../../app'
import { ComputerTestOptions } from '../types'

export const loadGovTests = (options: ComputerTestOptions) => {
  describe('gov', () => {
    describe('proposals', () => {
      beforeEach(async () => {
        // Set up gov.
        const blockTimestamp = new Date()
        await GovProposal.bulkCreate([
          {
            proposalId: '1',
            blockHeight: 1,
            blockTimeUnixMs: 1,
            blockTimestamp,
            data: '1-1',
          },
          {
            proposalId: '1',
            blockHeight: 2,
            blockTimeUnixMs: 2,
            blockTimestamp,
            data: '1-2',
          },
          {
            proposalId: '2',
            blockHeight: 3,
            blockTimeUnixMs: 3,
            blockTimestamp,
            data: '2-3',
          },
          {
            proposalId: '3',
            blockHeight: 4,
            blockTimeUnixMs: 4,
            blockTimestamp,
            data: '3-4',
          },
        ])

        await Block.createMany([
          {
            height: 1,
            timeUnixMs: 1,
          },
          {
            height: 2,
            timeUnixMs: 2,
          },
          {
            height: 3,
            timeUnixMs: 3,
          },
          {
            height: 4,
            timeUnixMs: 4,
          },
        ])

        await State.updateSingleton({
          latestBlockHeight: 4,
          latestBlockTimeUnixMs: 4,
          lastGovBlockHeightExported: 4,
        })
      })

      it('returns correct proposal response for a single block', async () => {
        await request(app.callback())
          .get('/generic/_/gov/proposal?block=1:1&id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            id: '1',
            data: '1-1',
          })

        await request(app.callback())
          .get('/generic/_/gov/proposal?block=3:3&id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            id: '1',
            data: '1-2',
          })

        // Returns latest if no block.
        await request(app.callback())
          .get('/generic/_/gov/proposal?id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            id: '1',
            data: '1-2',
          })
      })

      it('returns correct proposal response for multiple blocks', async () => {
        await request(app.callback())
          .get('/generic/_/gov/proposal?blocks=1:1..3:3&id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                id: '1',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                id: '1',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/proposal?blocks=1:1..3:3&blockStep=2&id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                id: '1',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                id: '1',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })

      it('returns correct proposal response for multiple times', async () => {
        await request(app.callback())
          .get('/generic/_/gov/proposal?times=1..3&id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                id: '1',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                id: '1',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/proposal?times=1..3&timeStep=2&id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                id: '1',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                id: '1',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })

      it('returns correct proposals response for a single block', async () => {
        await request(app.callback())
          .get('/generic/_/gov/proposals?block=1:1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            proposals: [
              {
                id: '1',
                data: '1-1',
              },
            ],
            total: 1,
          })

        await request(app.callback())
          .get('/generic/_/gov/proposals?block=3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            proposals: [
              {
                id: '1',
                data: '1-2',
              },
              {
                id: '2',
                data: '2-3',
              },
            ],
            total: 2,
          })

        // Returns latest if no block.
        await request(app.callback())
          .get('/generic/_/gov/proposals')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            proposals: [
              {
                id: '1',
                data: '1-2',
              },
              {
                id: '2',
                data: '2-3',
              },
              {
                id: '3',
                data: '3-4',
              },
            ],
            total: 3,
          })
      })

      it('returns correct proposals response for multiple blocks', async () => {
        await request(app.callback())
          .get('/generic/_/gov/proposals?blocks=1:1..3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-2',
                  },
                ],
                total: 1,
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
            {
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-2',
                  },
                  {
                    id: '2',
                    data: '2-3',
                  },
                ],
                total: 2,
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/proposals?blocks=1:1..3:3&blockStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-2',
                  },
                  {
                    id: '2',
                    data: '2-3',
                  },
                ],
                total: 2,
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])
      })

      it('returns correct proposals response for multiple times', async () => {
        await request(app.callback())
          .get('/generic/_/gov/proposals?times=1..3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-2',
                  },
                ],
                total: 1,
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
            {
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-2',
                  },
                  {
                    id: '2',
                    data: '2-3',
                  },
                ],
                total: 2,
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/proposals?times=1..3&timeStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                proposals: [
                  {
                    id: '1',
                    data: '1-2',
                  },
                  {
                    id: '2',
                    data: '2-3',
                  },
                ],
                total: 2,
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])
      })
    })

    describe('votes', () => {
      beforeEach(async () => {
        // Set up gov.
        const blockTimestamp = new Date()
        await GovProposalVote.bulkCreate([
          {
            proposalId: '1',
            voterAddress: 'a',
            blockHeight: 1,
            blockTimeUnixMs: 1,
            blockTimestamp,
            data: '1-1',
          },
          {
            proposalId: '1',
            voterAddress: 'a',
            blockHeight: 2,
            blockTimeUnixMs: 2,
            blockTimestamp,
            data: '1-2',
          },
          {
            proposalId: '1',
            voterAddress: 'b',
            blockHeight: 2,
            blockTimeUnixMs: 2,
            blockTimestamp,
            data: '1-2',
          },
          {
            proposalId: '2',
            voterAddress: 'b',
            blockHeight: 3,
            blockTimeUnixMs: 3,
            blockTimestamp,
            data: '2-3',
          },
        ])

        await Block.createMany([
          {
            height: 1,
            timeUnixMs: 1,
          },
          {
            height: 2,
            timeUnixMs: 2,
          },
          {
            height: 3,
            timeUnixMs: 3,
          },
        ])

        await State.updateSingleton({
          latestBlockHeight: 4,
          latestBlockTimeUnixMs: 4,
          lastGovBlockHeightExported: 4,
        })
      })

      it('returns correct vote response for a single block', async () => {
        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=a&block=1:1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            id: '1',
            voter: 'a',
            data: '1-1',
          })

        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=a&block=3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            id: '1',
            voter: 'a',
            data: '1-2',
          })

        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=b&block=3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            id: '1',
            voter: 'b',
            data: '1-2',
          })

        // Returns latest if no block.
        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=b')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            id: '1',
            voter: 'b',
            data: '1-2',
          })
      })

      it('returns correct vote response for multiple blocks', async () => {
        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=a&blocks=1:1..3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                id: '1',
                voter: 'a',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                id: '1',
                voter: 'a',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=a&blocks=1:1..3:3&blockStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                id: '1',
                voter: 'a',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                id: '1',
                voter: 'a',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })

      it('returns correct vote response for multiple times', async () => {
        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=a&times=1..3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                id: '1',
                voter: 'a',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                id: '1',
                voter: 'a',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/vote?id=1&voter=a&times=1..3&timeStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                id: '1',
                voter: 'a',
                data: '1-1',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                id: '1',
                voter: 'a',
                data: '1-2',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })

      it('returns correct votes response for a single block', async () => {
        await request(app.callback())
          .get('/generic/_/gov/votes?id=1&block=1:1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            votes: [
              {
                id: '1',
                voter: 'a',
                data: '1-1',
              },
            ],
            total: 1,
          })

        await request(app.callback())
          .get('/generic/_/gov/votes?id=1&block=3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            votes: [
              {
                id: '1',
                voter: 'a',
                data: '1-2',
              },
              {
                id: '1',
                voter: 'b',
                data: '1-2',
              },
            ],
            total: 2,
          })

        // Returns latest if no block.
        await request(app.callback())
          .get('/generic/_/gov/votes?id=1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            votes: [
              {
                id: '1',
                voter: 'a',
                data: '1-2',
              },
              {
                id: '1',
                voter: 'b',
                data: '1-2',
              },
            ],
            total: 2,
          })
      })

      it('returns correct votes response for multiple blocks', async () => {
        await request(app.callback())
          .get('/generic/_/gov/votes?id=1&blocks=1:1..3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-2',
                  },
                  {
                    id: '1',
                    voter: 'b',
                    data: '1-2',
                  },
                ],
                total: 2,
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/votes?id=1&blocks=1:1..3:3&blockStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-2',
                  },
                  {
                    id: '1',
                    voter: 'b',
                    data: '1-2',
                  },
                ],
                total: 2,
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })

      it('returns correct votes response for multiple times', async () => {
        await request(app.callback())
          .get('/generic/_/gov/votes?id=1&times=1..3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-2',
                  },
                  {
                    id: '1',
                    voter: 'b',
                    data: '1-2',
                  },
                ],
                total: 2,
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get('/generic/_/gov/votes?id=1&times=1..3&timeStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-1',
                  },
                ],
                total: 1,
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                votes: [
                  {
                    id: '1',
                    voter: 'a',
                    data: '1-2',
                  },
                  {
                    id: '1',
                    voter: 'b',
                    data: '1-2',
                  },
                ],
                total: 2,
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })
    })
  })
}
