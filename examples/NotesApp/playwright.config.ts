import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './web-tests',
  timeout: 600_000,
  use: {
    baseURL: 'http://127.0.0.1:4177',
    browserName: 'chromium',
    ...(process.env.CI ? {} : { channel: 'msedge' }),
  },
  webServer: {
    command: 'node scripts/serve-dist.mjs',
    port: 4177,
    reuseExistingServer: !process.env.CI,
  },
})
