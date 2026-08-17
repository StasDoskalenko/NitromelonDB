const fs = require('fs')
const path = require('path')

const defaultWinAppDriver = path.join(
  process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
  'Windows Application Driver',
  'WinAppDriver.exe',
)
const localWinAppDriver = path.join(
  __dirname,
  '.tmp',
  'WinAppDriver',
  'Windows Application Driver',
  'WinAppDriver.exe',
)

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
    ...(!fs.existsSync(defaultWinAppDriver) && fs.existsSync(localWinAppDriver)
      ? {winAppDriverBin: localWinAppDriver}
      : {}),
    webdriverOptions: {
      logLevel: 'info',
      waitforTimeout: 120000,
      connectionRetryTimeout: 30000,
      connectionRetryCount: 10,
    },
  },
}
