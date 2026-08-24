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
const {prepareFreshLaunch, killApp, killWinAppDriver} = require('./app-process')

const DIAGNOSTICS_DIR = path.join(__dirname, '..', '.tmp', 'diagnostics')

function sanitize(name) {
  return String(name).replace(/[^a-z0-9]+/gi, '-').slice(0, 100)
}

// Connects to the Root/Desktop session and lists every top-level window with
// its Name and bounds (raw WinAppDriver BoundingRectangle format, e.g.
// "Left:18 Top:26 Width:1044 Height:635"). Caller owns closing nothing —
// the Root session is closed here before returning.
async function listTopLevelWindows(remote) {
  const root = await remote({
    hostname: '127.0.0.1',
    port: 4723,
    logLevel: 'error',
    capabilities: {app: 'Root', 'ms:experimental-webdriver': true},
  })
  try {
    const windows = await root.$$('//Window')
    const result = []
    for (const w of windows) {
      const [name, rect] = await Promise.all([
        w.getAttribute('Name').catch(() => '?'),
        w.getAttribute('BoundingRectangle').catch(() => '?'),
      ])
      result.push({name, rect})
    }
    return result
  } finally {
    await root.deleteSession()
  }
}

class NotesAppEnvironment extends AutomationEnvironment {
  async setup() {
    prepareFreshLaunch()
    await super.setup()
    // Bare `global` here is the Jest worker process's own global, not the
    // per-test-file sandboxed one — this class runs outside that sandbox.
    // `this.global` is the object test files actually see as `global`.
    try {
      await this.global.browser.setTimeout({implicit: 0})
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

  // WebDriver command logs only show what was *asked* — the actual UI
  // Automation tree at the moment of failure is otherwise invisible. Dump it
  // (plus a screenshot) so CI failures are diagnosable without reproducing
  // locally. `browser` may already be gone if setup itself failed.
  //
  // This is what tracked down a real bug: GitHub-hosted Windows runners
  // default to a 1024x768 virtual display (actions/runner-images#2935),
  // smaller than the app's 1000x1000 default window. UI Automation reports
  // elements by logical layout regardless of what's actually painted, so
  // WinAppDriver could still find and click delete-button-*/add-note-button
  // (both past the screen edge) — the click just landed on pixels that were
  // never rendered. Fixed at the source in ci.yml (Set-DisplayResolution
  // -Width 1920 -Height 1080, a built-in Server Core cmdlet and GitHub's own
  // confirmed-working max resolution) rather than compensating for a small
  // screen from the app side — window-fitting logic tried here first, but
  // needed multiple rounds of pixel-sampled diagnostics to even find the
  // real constraint (a second stable top-level window, not the reported
  // screen work area) and kept picking up unrelated windows on a dev
  // machine. The top-level-window dump below is what found that; keeping it
  // for any future case where something is genuinely covering the app.
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
    try {
      const windows = await listTopLevelWindows(this.global.remote)
      fs.writeFileSync(
        `${base}.top-level-windows.txt`,
        windows.map((w) => `${w.name}: ${w.rect}`).join('\n'),
      )
    } catch (error) {
      fs.writeFileSync(`${base}.top-level-windows-error.txt`, String(error))
    }
    // eslint-disable-next-line no-console
    console.log(`Diagnostics saved: ${base}.*`)
  }
}

module.exports = NotesAppEnvironment
