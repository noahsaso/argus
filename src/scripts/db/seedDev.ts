import { Command } from 'commander'

import { ConfigManager } from '@/config'
import {
  Account,
  AccountKey,
  AccountKeyCredit,
  AccountKeyCreditPaymentSource,
  GovProposal,
  State,
  loadDb,
} from '@/db'
import { DbType } from '@/types'

export const main = async () => {
  // Parse arguments.
  const program = new Command()
  program.option(
    '-c, --config <path>',
    'path to config file, falling back to config.json'
  )
  program.parse()
  const { config: _config } = program.opts()

  // Load config from specific config file.
  const config = ConfigManager.load(_config)

  const dataSequelize = await loadDb({
    type: DbType.Data,
  })
  const accountsSequelize = await loadDb({
    type: DbType.Accounts,
  })

  // Set up dev account.
  const [testAccount] = await Account.findOrCreate({
    where: {
      publicKey: 'dev',
    },
    include: [
      {
        model: AccountKey,
        include: [
          {
            model: AccountKeyCredit,
          },
        ],
      },
    ],
  })
  // Create dev account key if it doesn't exist.
  const keys = (await testAccount.$get('keys')) ?? []
  if (!keys.some(({ name }) => name === 'dev')) {
    const accountKey = await testAccount.$create<AccountKey>('key', {
      name: 'dev',
      description: 'dev',
      hashedKey: AccountKey.hashKey('dev'),
    })
    // Create dev account key infinite dev credit.
    await accountKey.$create<AccountKeyCredit>('credit', {
      paymentSource: AccountKeyCreditPaymentSource.Manual,
      paymentId: 'dev',
      paidAt: new Date(),
      amount: -1,
    })
  }

  // Add gov.
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

  await State.updateSingleton({
    chainId: config.chainId,
    latestBlockHeight: 4,
    latestBlockTimeUnixMs: 4,
    lastGovBlockHeightExported: 4,
  })

  await accountsSequelize.close()
  await dataSequelize.close()

  process.exit(0)
}

main()
