import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Do not load the application test setup: WebSocket lifecycle tests need no
// configuration, databases, queues or service updaters.
export default defineConfig({
  test: {
    include: ['src/services/ChainWebSocketListener.test.ts'],
    watch: false,
  },
  plugins: [tsconfigPaths()],
})
