import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './web-tests',
  timeout: 600_000,
  use: {
    baseURL: 'http://127.0.0.1:4177',
    browserName: 'chromium',
    ...(process.env.CI ? {} : { channel: 'msedge' }),
  },
  webServer: [
    {
      command: 'node scripts/serve-dist.mjs',
      port: 4177,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The reference sync server (examples/sync-server) for web-tests/sync.spec.ts, on the URL the
      // app syncs with by default (src/sync.ts). Needs `yarn install` in examples/sync-server.
      command: 'node ../sync-server/src/main.ts',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: '3000',
        DATABASE: ':memory:',
        SYNC_SERVER_SCHEMA: 'notes-app',
        SYNC_SERVER_TEST_HOOKS: '1',
        SYNC_SERVER_CORS_ORIGIN: 'http://127.0.0.1:4177',
      },
    },
  ],
})
