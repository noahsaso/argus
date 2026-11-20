import { Sequelize } from 'sequelize'

import { State } from '@/db'

/**
 * The height the listener should start from.
 *
 * The listener records the last block it fully processed in
 * `State.listenerLatestBlockHeight`, and resumes from the block after it.
 * `State.latestBlockHeight` cannot be used for this because the tracer and the
 * extract queue also advance it, so after a crash it can be past blocks the
 * listener never processed.
 *
 * Until the listener has recorded a height (for example on the first deploy
 * with this column), fall back to `State.latestBlockHeight`, which was the
 * previous behavior.
 */
export const getListenerStartHeight = (
  state: Pick<State, 'latestBlockHeight' | 'listenerLatestBlockHeight'>
): number =>
  state.listenerLatestBlockHeight !== null &&
  state.listenerLatestBlockHeight !== undefined
    ? Number(state.listenerLatestBlockHeight) + 1
    : Number(state.latestBlockHeight)

/**
 * Record that the listener has fully processed a block: every transaction in
 * it has been matched against the extractors and any matches queued. Never
 * moves the height backwards.
 */
export const saveListenerProcessedHeight = async (
  height: number
): Promise<void> => {
  await State.updateSingleton({
    listenerLatestBlockHeight: Sequelize.fn(
      'GREATEST',
      Sequelize.col('listenerLatestBlockHeight'),
      height
    ),
  })
}
