// End-to-end sync tests against the reference server in examples/sync-server.
// Install its dependencies first: yarn --cwd examples/sync-server install
const base = require('./jest.config')

module.exports = {
  ...base,
  testMatch: ['<rootDir>/src/sync/__tests__/e2e/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 60000,
  bail: false,
}
