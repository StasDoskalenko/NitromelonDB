/**
 * Jest environment: wipe LocalState, then let WinAppDriver launch/attach.
 * Closing the app from a test would break the HWND session (see helpers).
 *
 * @format
 */

const fs = require('fs')
const path = require('path')
const Automation = require('@react-native-windows/automation')
const AutomationEnvironment = Automation.default || Automation
const {prepareFreshLaunch, killApp, killWinAppDriver, screenWorkArea} = require('./app-process')

const DIAGNOSTICS_DIR = path.join(__dirname, '..', '.tmp', 'diagnostics')

function sanitize(name) {
  return String(name).replace(/[^a-z0-9]+/gi, '-').slice(0, 100)
}

class NotesAppEnvironment extends AutomationEnvironment {
  async setup() {
    prepareFreshLaunch()
    await super.setup()
    try {
      await global.browser.setTimeout({implicit: 0})
    } catch {
      // session not ready
    }
    // UI Automation reports elements by the window's logical layout, not by
    // what's actually been painted. On a CI session whose real screen is
    // smaller than the app's default window size, elements past the screen
    // edge are still "found" and "clicked" by WinAppDriver, but the click
    // lands on real pixels that were never rendered and hits nothing —
    // confirmed by pixel-sampling a failure screenshot (solid black past a
    // hard edge, matching an element WinAppDriver had just clicked with no
    // effect). Fit the window inside the real screen so every element is
    // genuinely paintable, not just logically present in the tree.
    try {
      const {width, height} = screenWorkArea()
      await global.browser.setWindowRect(0, 0, width, height)
    } catch {
      // best-effort; if this fails, tests will surface real timeouts instead
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

  // WebDriver command logs only show what was *asked* — the actual UI
  // Automation tree at the moment of failure is otherwise invisible. Dump it
  // (plus a screenshot) so CI failures are diagnosable without reproducing
  // locally. `browser` may already be gone if setup itself failed.
  async handleTestEvent(event) {
    if (event.name !== 'test_fn_failure' || !this.global.browser) {
      return
    }
    const base = path.join(DIAGNOSTICS_DIR, `${sanitize(event.test.name)}-${Date.now()}`)
    fs.mkdirSync(DIAGNOSTICS_DIR, {recursive: true})
    try {
      const source = await this.global.browser.getPageSource()
      fs.writeFileSync(`${base}.xml`, source)
    } catch (error) {
      fs.writeFileSync(`${base}.source-error.txt`, String(error))
    }
    try {
      await this.global.browser.saveScreenshot(`${base}.png`)
    } catch (error) {
      fs.writeFileSync(`${base}.screenshot-error.txt`, String(error))
    }
    // eslint-disable-next-line no-console
    console.log(`Diagnostics saved: ${base}.{xml,png}`)
  }
}

module.exports = NotesAppEnvironment
