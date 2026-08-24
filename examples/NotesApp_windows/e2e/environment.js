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
// Matches appWindow.Resize({1000, 1000}) in NitromelonWindows.cpp — the
// size the app has actually been laid out against. Only ever shrink to fit
// a smaller CI screen; ballooning to a much larger, never-tested window
// size (e.g. a dev machine's full monitor) introduced its own flakiness.
const DEFAULT_WINDOW_SIZE = {width: 1000, height: 1000}
// A dev machine has many other windows open (browser, terminal, tray icons —
// some legitimately tiny or 0-sized). Never let a sibling window's bounds
// shrink the target below something the app can actually lay out in.
const MIN_WINDOW_SIZE = {width: 400, height: 400}

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

function parseBoundingRectangle(rect) {
  const m = /Left:(-?\d+)\s+Top:(-?\d+)\s+Width:(\d+)\s+Height:(\d+)/.exec(rect || '')
  if (!m) {
    return null
  }
  return {left: Number(m[1]), top: Number(m[2]), width: Number(m[3]), height: Number(m[4])}
}

class NotesAppEnvironment extends AutomationEnvironment {
  async setup() {
    prepareFreshLaunch()
    await super.setup()
    // Bare `global` here is the Jest worker process's own global, not the
    // per-test-file sandboxed one — this class runs outside that sandbox.
    // `this.global` is the object test files actually see as `global`.
    // (A prior version of this method used bare `global` for the call below
    // and it silently failed every time behind an empty catch — undetected
    // since nothing depended on the implicit-wait setting actually applying.)
    try {
      await this.global.browser.setTimeout({implicit: 0})
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
    //
    // Logged unconditionally (not just on error): a prior attempt at this
    // silently no-op'd — window size was unchanged in the next failure's
    // diagnostics — and a swallowed try/catch gave no way to tell why (it
    // turned out to be this same bare-`global` mistake).
    //
    // screenWorkArea() (PrimaryScreen.WorkingArea) turned out not to be the
    // real constraint either: resizing to it still left elements past a
    // pixel-verified render edge. A Root-session window dump showed a
    // second, stable top-level window — GitHub's own hosted-compute-agent —
    // with noticeably smaller bounds than WorkingArea (635 vs 720 tall in
    // one run), identical across two diagnostics in the same run. That's
    // almost certainly the actual interactive viewport on this CI session.
    // Fit inside whichever reported constraint is smallest.
    try {
      const screen = screenWorkArea()
      let target = {
        width: Math.min(screen.width, DEFAULT_WINDOW_SIZE.width),
        height: Math.min(screen.height, DEFAULT_WINDOW_SIZE.height),
      }
      // A dev machine has many other windows open (browser, terminal, IDE —
      // one was 635px tall locally and got treated as "the" constraint,
      // shrinking the target enough to push a note out of the interactive
      // area and break an unrelated test). Only look for a specific known
      // constraint — GitHub's hosted-compute-agent — on CI, where it's
      // been confirmed present and stable; trust screenWorkArea() locally,
      // already verified reliable on its own.
      if (process.env.CI) {
        try {
          const windows = await listTopLevelWindows(this.global.remote)
          for (const w of windows) {
            if (w.name === 'NitromelonWindows') {
              continue
            }
            const rect = parseBoundingRectangle(w.rect)
            // Only a window at least as big as our own minimum plausibly
            // represents an actual viewport constraint like the CI
            // session's hosted-compute-agent; ignore anything smaller
            // rather than letting it shrink the target into nonsense.
            if (!rect || rect.width < MIN_WINDOW_SIZE.width || rect.height < MIN_WINDOW_SIZE.height) {
              continue
            }
            // Safety margin for our own window's chrome (title bar/
            // borders) — WinAppDriver's window-size target is the client
            // area, while this sibling window's bounds are its outer rect.
            target = {
              width: Math.min(target.width, rect.width - 20),
              height: Math.min(target.height, rect.height - 40),
            }
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.log(`Sibling-window bounds lookup failed: ${error}`)
        }
      }
      target = {
        width: Math.max(target.width, MIN_WINDOW_SIZE.width),
        height: Math.max(target.height, MIN_WINDOW_SIZE.height),
      }
      const before = await this.global.browser.getWindowSize()
      if (target.width !== before.width || target.height !== before.height) {
        // setWindowRect is W3C-only; WinAppDriver predates the W3C WebDriver
        // spec and only speaks the older JSONWP window/current/size
        // endpoint. setWindowSize() picks the right one via browser.isW3C.
        await this.global.browser.setWindowSize(target.width, target.height)
        // Give the app's own layout pass a chance to settle after a resize
        // before any test interacts with it — a previous attempt without
        // this wait introduced new flakiness in previously-reliable tests
        // once the resize actually started taking effect (it had silently
        // no-op'd before that, per the this.global fix above).
        await this.global.browser.waitUntil(
          async () => {
            try {
              const el = await this.global.browser.$('~subtitle')
              return await el.isDisplayed()
            } catch {
              return false
            }
          },
          {timeout: 15000, timeoutMsg: 'App did not settle after window resize'},
        )
      }
      const after = await this.global.browser.getWindowSize()
      // eslint-disable-next-line no-console
      console.log(
        `Window resize: isW3C=${this.global.browser.isW3C} screen=${screen.width}x${screen.height} target=${target.width}x${target.height} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      )
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(`Window resize failed: ${error}`)
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
    // Rule out a sibling top-level window (notification, RDP toolbar, etc.)
    // physically overlapping the app rather than the app failing to paint
    // there itself — list every top-level window and its bounds. (This is
    // also what setup() uses to size the window in the first place.)
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
