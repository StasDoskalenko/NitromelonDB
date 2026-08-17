module.exports = {
  testEnvironment: '@react-native-windows/automation',
  testMatch: ['<rootDir>/e2e/**/*.test.js'],
  testTimeout: 180000,
  maxWorkers: 1,
  verbose: true,
  testEnvironmentOptions: {
    app: 'NitromelonWindows',
    // Packaged WinAppSDK apps start a process that WinAppDriver cannot attach
    // to by AUMID. Launch via the shell and bind the HWND from a Root session.
    useRootSession: true,
    webdriverOptions: {
      logLevel: 'info',
      waitforTimeout: 120000,
      connectionRetryTimeout: 30000,
      connectionRetryCount: 10,
    },
  },
}
