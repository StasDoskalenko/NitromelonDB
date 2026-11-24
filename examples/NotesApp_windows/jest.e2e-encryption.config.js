// The Windows steps of the encryption upgrade (e2e-encryption/README.md). Run one file at a time
// by scripts/ci-notesapp-encryption-upgrade.sh, which switches builds and checks the database file
// between them. Same WinAppDriver setup as jest.e2e.config.js, except that LocalState is kept.
const base = require('./jest.e2e.config')

module.exports = {
  ...base,
  testMatch: ['<rootDir>/e2e-encryption/**/*.test.js'],
  testEnvironmentOptions: {
    ...base.testEnvironmentOptions,
    keepAppState: true,
  },
}
