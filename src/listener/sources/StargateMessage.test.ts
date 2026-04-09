import { describe, expect, it } from 'vitest'

import { StargateMessageDataSource } from './StargateMessage'

describe('StargateMessageDataSource', () => {
  it('matches decoded stargate messages and preserves message index', () => {
    const source = new StargateMessageDataSource({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    })

    const matches = source.match({
      hash: 'tx-hash',
      messages: [
        {
          typeUrl: '/cosmos.bank.v1beta1.MsgDelegate',
          value: {
            delegatorAddress: 'xion1delegator',
          },
        },
        {
          typeUrl: '/cosmos.bank.v1beta1.MsgSend',
          value: {
            fromAddress: 'xion1sender',
            toAddress: 'xion1recipient',
            amount: [
              {
                denom: 'uxion',
                amount: '42',
              },
            ],
          },
        },
      ] as any,
      events: [],
    })

    expect(matches).toEqual([
      {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: 'xion1sender',
          toAddress: 'xion1recipient',
          amount: [
            {
              denom: 'uxion',
              amount: '42',
            },
          ],
        },
        messageIndex: 1,
      },
    ])
  })

  it('ignores non-decoded messages', () => {
    const source = new StargateMessageDataSource({
      typeUrl: ['/cosmos.bank.v1beta1.MsgSend'],
    })

    expect(
      source.match({
        hash: 'tx-hash',
        messages: [{ foo: 'bar' }, null] as any,
        events: [],
      })
    ).toEqual([])
  })
})
