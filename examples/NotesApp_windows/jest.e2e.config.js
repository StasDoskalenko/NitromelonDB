module.exports = {
  testEnvironment: '@react-native-windows/automation',
  testMatch: ['<rootDir>/e2e/**/*.test.js'],
  testTimeout: 180000,
  maxWorkers: 1,
  verbose: true,
  testEnvironmentOptions: {
    app: 'NitromelonWindows',
    webdriverOptions: {
      logLevel: 'info',
      waitforTimeout: 120000,
      connectionRetryTimeout: 30000,
      connectionRetryCount: 10,
    },
  },
}
