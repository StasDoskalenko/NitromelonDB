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
    command: 'python -m http.server 4177 --bind 127.0.0.1 --directory dist-web-test',
    port: 4177,
    reuseExistingServer: !process.env.CI,
  },
})
