/**
 * Jest environment: wipe LocalState, then let WinAppDriver launch/attach.
 * Closing the app from a test would break the HWND session (see helpers).
 *
 * @format
 */

const Automation = require('@react-native-windows/automation')
const AutomationEnvironment = Automation.default || Automation
const {prepareFreshLaunch, killApp, killWinAppDriver} = require('./app-process')

class NotesAppEnvironment extends AutomationEnvironment {
  async setup() {
    prepareFreshLaunch()
    await super.setup()
    try {
      await global.browser.setTimeout({implicit: 0})
    } catch {
      // session not ready
    }
  }

  async teardown() {
    try {
      await super.teardown()
    } catch {
      // closeWindow fails if a test already killed the HWND (kill-and-relaunch).
    }
    killApp()
    killWinAppDriver()
  }
}

module.exports = NotesAppEnvironment
