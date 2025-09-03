import { defaultExclude, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  test: {
    exclude: [...defaultExclude, 'src/test/dump/**'],
    setupFiles: ['./src/test/setup.ts'],
    watch: false,
    hideSkippedTests: true,
    // 35 second timeout for tests.
    testTimeout: 35_000,
    hookTimeout: 35_000,
  },
  plugins: [tsconfigPaths()],
})
