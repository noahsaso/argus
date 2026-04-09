import http, { IncomingMessage } from 'http'

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { SigningStargateClient, coins } from '@cosmjs/stargate'
import { decodeRawProtobufMsg } from '@dao-dao/types/protobuf/utils'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { ConfigManager } from '@/config'
import { AccountDepositWebhookRegistration, Extraction, State } from '@/db'
import { getExtractors } from '@/listener'
import { closeAllBullQueues } from '@/queues'
import { QueueOptions } from '@/queues/base'
import { ExtractQueue, WebhooksQueue } from '@/queues/queues'
import { app as accountApp } from '@/server/test/account/app'
import { BlockIterator } from '@/services'
import { getAccountWithAuth } from '@/test/utils'
import { ExtractableTxInput, ExtractorEnv } from '@/types'
import { AutoCosmWasmClient } from '@/utils'

const VALIDATOR_MNEMONIC =
  'decorate bright ozone fork gallery riot bus exhaust worth way bone indoor calm squirrel merry zero scheme cotton until shop any excess stage laundry'
const DEPOSIT_AMOUNT = '12345'

type ReceivedWebhook = {
  headers: IncomingMessage['headers']
  body: any
}

const enabled = process.env.DEPOSIT_WEBHOOK_E2E === 'true'

const waitFor = async <T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 45_000,
  intervalMs = 250
): Promise<T> => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn()
    if (value !== undefined) {
      return value
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out after ${timeoutMs}ms.`)
}

describe.runIf(enabled)('deposit webhook validator e2e', () => {
  let receiver: http.Server | undefined

  afterEach(async () => {
    await closeAllBullQueues()
    await AccountDepositWebhookRegistration.closeActiveRegistrationsCacheSubscription()
    await new Promise<void>((resolve, reject) => {
      if (!receiver) {
        resolve()
        return
      }

      receiver.close((error) => (error ? reject(error) : resolve()))
      receiver = undefined
    })
  })

  it('delivers a webhook for a real inbound native transfer', async () => {
    const config = ConfigManager.load()
    const rpcUrl = config.remoteRpc

    await State.createSingletonIfMissing(config.chainId)

    const receiverPromise = new Promise<ReceivedWebhook>((resolve) => {
      receiver = http.createServer((req, res) => {
        let body = ''

        req.on('data', (chunk) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          res.statusCode = 200
          res.end('ok')

          resolve({
            headers: req.headers,
            body: JSON.parse(body),
          })
        })
      })
    })

    await new Promise<void>((resolve, reject) => {
      receiver!.listen(0, '127.0.0.1', (error?: Error) =>
        error ? reject(error) : resolve()
      )
    })

    const receiverPort = (
      receiver!.address() as {
        port: number
      }
    ).port

    const { token } = await getAccountWithAuth()

    const watchedWallet = await DirectSecp256k1HdWallet.generate(12, {
      prefix: config.bech32Prefix,
    }).then(async (wallet) => (await wallet.getAccounts())[0].address)

    await request(accountApp.callback())
      .post('/deposit-webhook-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'validator e2e',
        endpointUrl: `http://127.0.0.1:${receiverPort}/deposits`,
        authHeader: 'Authorization',
        authToken: 'secret-token',
        watchedWallets: [watchedWallet],
        allowedNativeDenoms: ['uxion'],
        enabled: true,
      })
      .expect(201)

    const workerOptions: QueueOptions = {
      config,
      sendWebhooks: true,
    }
    const extractQueue = new ExtractQueue(workerOptions)
    await extractQueue.init()
    const extractWorker = extractQueue.getWorker()
    const webhooksWorker = new WebhooksQueue(workerOptions).getWorker()

    await Promise.all([
      extractWorker.waitUntilReady(),
      webhooksWorker.waitUntilReady(),
    ])

    const autoCosmWasmClient = new AutoCosmWasmClient(rpcUrl)
    await autoCosmWasmClient.update()

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      VALIDATOR_MNEMONIC,
      {
        prefix: config.bech32Prefix,
      }
    )
    const [validatorAccount] = await wallet.getAccounts()
    const signingClient = await SigningStargateClient.connectWithSigner(
      rpcUrl,
      wallet
    )

    await waitFor(async () =>
      (await signingClient.getHeight()) >= 12 ? true : undefined
    )
    const startHeight = await signingClient.getHeight()

    const blockIterator = new BlockIterator({
      rpcUrl,
      autoCosmWasmClient,
      startHeight,
    })

    const iteratorPromise = blockIterator.iterate({
      onTx: async (
        { hash, code, messages: rawMessages, height, events },
        block
      ) => {
        if (code !== 0) {
          return
        }

        const messages = rawMessages.flatMap((message) => {
          try {
            return decodeRawProtobufMsg(message)
          } catch {
            return message
          }
        })

        const input: ExtractableTxInput = {
          hash,
          messages,
          events,
        }

        const env: Pick<ExtractorEnv, 'txHash' | 'block'> = {
          txHash: hash,
          block: {
            height: BigInt(height).toString(),
            timeUnixMs: BigInt(Date.parse(block.time)).toString(),
            timestamp: new Date(block.time).toISOString(),
          },
        }

        for (const Extractor of getExtractors()) {
          const data = Extractor.match(input)
          if (data.length === 0) {
            continue
          }

          await ExtractQueue.addBulk(
            data.map((matched) => ({
              name: `${Extractor.type} (${matched.source})`,
              data: {
                extractor: Extractor.type,
                data: matched,
                env,
              },
            }))
          )
        }
      },
    })

    const result = await signingClient.sendTokens(
      validatorAccount.address,
      watchedWallet,
      coins(DEPOSIT_AMOUNT, 'uxion'),
      {
        amount: [],
        gas: '200000',
      }
    )

    expect(result.code).toBe(0)

    const webhook = await receiverPromise

    expect(webhook.headers.authorization).toBe('Bearer secret-token')
    expect(webhook.headers['idempotency-key']).toContain(
      `${config.chainId}:1:${result.transactionHash}:${watchedWallet}:native:uxion:${DEPOSIT_AMOUNT}`
    )
    expect(webhook.body).toMatchObject({
      wallet: watchedWallet,
      recipient: watchedWallet,
      sender: validatorAccount.address,
      denom: 'uxion',
      amount: DEPOSIT_AMOUNT,
      assetType: 'native',
      contractAddress: null,
      txHash: result.transactionHash,
    })

    await waitFor(async () => {
      const extraction = await Extraction.findOne({
        where: {
          txHash: result.transactionHash,
        },
      })

      return extraction ?? undefined
    })

    blockIterator.stopFetching()
    await iteratorPromise

    await Promise.all([extractWorker.close(), webhooksWorker.close()])
  }, 90_000)
})
