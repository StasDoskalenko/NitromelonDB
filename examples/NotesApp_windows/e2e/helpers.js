/**
 * WinAppDriver helpers that mirror Maestro flow primitives
 * (assertVisible, tapOn, inputText, killApp).
 *
 * App launch + clearState happen in e2e/environment.js before each file.
 *
 * @format
 */
/* global browser, remote */

const {app} = require('@react-native-windows/automation')
const {killApp, launchApp} = require('./app-process')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForSubtitle(timeout = 60000) {
  await app.waitUntil(
    async () => {
      try {
        const el = await app.findElementByTestID('subtitle')
        return el.isDisplayed()
      } catch {
        return false
      }
    },
    {timeout, timeoutMsg: 'subtitle was not visible'},
  )
}

async function subtitleText() {
  const el = await app.findElementByTestID('subtitle')
  return el.getText()
}

async function waitForNoteCount(count, timeout = 60000) {
  await app.waitUntil(
    async () => {
      const match = (await subtitleText()).match(/(\d+) notes?/)
      return match ? parseInt(match[1], 10) === count : false
    },
    {timeout, timeoutMsg: `Did not reach ${count} notes`},
  )
}

async function waitForSeeded() {
  await waitForSubtitle()
  await waitForNoteCount(100)
}

async function elementText(el) {
  try {
    return (await el.getText()) || ''
  } catch {
    return ''
  }
}

async function textVisible(text) {
  const labeledIds = ['app-title', 'page-label', 'subtitle']
  for (const id of labeledIds) {
    try {
      const el = await app.findElementByTestID(id)
      const t = await elementText(el)
      if (t === text || t.includes(text)) {
        return true
      }
    } catch {
      // not mounted yet
    }
  }

  try {
    const el = await app.findElementByTestID('notes-list')
    const titles = (await elementText(el))
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    if (titles.includes(text)) {
      return true
    }
  } catch {
    // list anchor not mounted yet
  }

  try {
    const el = await app.findElementByTestID(text)
    if (!el || typeof el.isDisplayed !== 'function') {
      return false
    }
    return el.isDisplayed()
  } catch {
    return false
  }
}

async function waitForText(text, timeout = 15000) {
  await app.waitUntil(async () => textVisible(text), {
    timeout,
    timeoutMsg: `Not visible: ${text}`,
  })
}

async function waitForTextGone(text, timeout = 15000) {
  await app.waitUntil(async () => !(await textVisible(text)), {
    timeout,
    timeoutMsg: `Still visible: ${text}`,
  })
}

async function waitForTestID(id, timeout = 15000) {
  await app.waitUntil(
    async () => {
      try {
        await app.findElementByTestID(id)
        return true
      } catch {
        return false
      }
    },
    {timeout, timeoutMsg: `testID not visible: ${id}`},
  )
}

async function tapTestID(id) {
  const el = await app.findElementByTestID(id)
  await el.click()
}

async function tapName(name) {
  const el = await app.findElementByXPath(`//*[@Name="${name}"]`)
  await el.click()
}

function actionTestID(action, title) {
  return `${action}-button-${String(title).replace(/\s+/g, '-')}`
}

// PowerShell SendKeys + SetForegroundWindow used to type here, but it silently
// no-ops in CI: SetForegroundWindow is refused when the calling process didn't
// originate the input focus (Windows' foreground-lock), so keystrokes land
// nowhere and the title field stays empty. browser.keys() goes through the
// same WinAppDriver session as every other command (already proven to reach
// the app in CI via scrollUntilText's PageDown) and needs no OS-level focus
// dance. Backspace first in case a prior attempt left a partial title.
async function addNote(title) {
  const before = await subtitleText()
  const match = before.match(/(\d+) notes?/)
  const nextCount = (match ? parseInt(match[1], 10) : 0) + 1
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    const input = await app.findElementByTestID('title-input')
    await input.click()
    await sleep(200)
    await browser.keys(Array(80).fill('Backspace'))
    await browser.keys(title.split(''))
    await sleep(300)
    // browser.keys() reaches the driver session (confirmed in CI logs), but
    // RNW's onChangeText bridge event for a `defaultValue`-based (uncontrolled)
    // TextInput may not fire for driver-injected input, leaving the app's
    // title state empty so Add silently no-ops. Read the control back and
    // retype through the same path if it didn't take, instead of guessing.
    for (let readback = 0; readback < 3; readback++) {
      const currentValue = await input.getText().catch(() => '')
      if (currentValue === title) {
        break
      }
      await input.click()
      await browser.keys(Array(80).fill('Backspace'))
      await browser.keys(title.split(''))
      await sleep(300)
    }
    // The control's own text reads back correctly (confirmed in CI logs) even
    // when Add still no-ops: NotesComposer tracks the title via onChangeText
    // into a ref (titleRef) for Windows, and driver-injected input may not
    // fire that bridge event even though it lands in the native control.
    // Submit via Enter first — onSubmitEditing reads event.nativeEvent.text,
    // the native control's own current text, sidestepping titleRef entirely.
    await browser.keys(['Enter'])
    try {
      await waitForNoteCount(nextCount, 6000)
      return
    } catch {
      // fall through to the Add button as a second attempt this round
    }
    try {
      await tapName('Add note')
    } catch {
      await tapTestID('add-note-button')
    }
    try {
      await waitForNoteCount(nextCount, 6000)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function dismissKeyboard() {
  await tapName('NitromelonDB')
}

async function isPinned(title) {
  try {
    const el = await app.findElementByTestID(actionTestID('pin', title))
    const name = await el.getAttribute('Name')
    const t = await elementText(el)
    return name === 'Unpin' || t.includes('Unpin')
  } catch {
    return false
  }
}

async function pinNote(title, timeout = 15000) {
  await app.waitUntil(
    async () => {
      if (await isPinned(title)) {
        return true
      }
      try {
        const el = await app.findElementByTestID(actionTestID('pin', title))
        await el.click()
        await sleep(400)
        return isPinned(title)
      } catch {
        return false
      }
    },
    {timeout, timeoutMsg: `${title} was not pinned`},
  )
}

async function waitForPinned(title, timeout = 15000) {
  await app.waitUntil(async () => isPinned(title), {
    timeout,
    timeoutMsg: `${title} was not pinned`,
  })
}

async function deleteNote(title) {
  const el = await app.findElementByTestID(actionTestID('delete', title))
  await el.click()
}

async function focusNotesList() {
  const candidates = ['Note #20', 'Note #100', 'Note #40', 'Note #80', 'notes-list']
  for (const id of candidates) {
    try {
      const el = await app.findElementByTestID(id)
      if (await el.isDisplayed()) {
        await el.click()
        return
      }
    } catch {
      // try next
    }
  }
}

async function scrollUntilText(text, timeout = 20000) {
  await focusNotesList()
  await app.waitUntil(
    async () => {
      if (await textVisible(text)) {
        return true
      }
      await browser.keys(['PageDown'])
      await sleep(250)
      return false
    },
    {timeout, timeoutMsg: `Did not scroll to ${text}`},
  )
}

async function attachToAppWindow() {
  const root = await remote({
    hostname: '127.0.0.1',
    port: 4723,
    logLevel: 'info',
    capabilities: {
      app: 'Root',
      'ms:experimental-webdriver': true,
    },
  })
  try {
    const deadline = Date.now() + 30000
    let handle
    while (Date.now() < deadline) {
      const windows = await root.$$('//Window')
      for (const window of windows) {
        if ((await window.getAttribute('Name')) === 'NitromelonWindows') {
          handle = parseInt(await window.getAttribute('NativeWindowHandle'), 10)
          break
        }
      }
      if (handle) {
        break
      }
      await sleep(500)
    }
    if (!handle) {
      throw new Error('Unable to find NitromelonWindows window after relaunch')
    }
    const next = await remote({
      hostname: '127.0.0.1',
      port: 4723,
      logLevel: 'info',
      waitforTimeout: 5000,
      connectionRetryTimeout: 30000,
      connectionRetryCount: 10,
      capabilities: {
        appTopLevelWindow: '0x' + handle.toString(16),
        'ms:experimental-webdriver': true,
      },
    })
    global.browser = next
    global.$ = next.$.bind(next)
    global.$$ = next.$$.bind(next)
  } finally {
    await root.deleteSession()
  }
}

async function killAndRelaunch() {
  killApp()
  await sleep(2000)
  launchApp()
  await attachToAppWindow()
  await waitForSubtitle()
}

module.exports = {
  addNote,
  deleteNote,
  dismissKeyboard,
  killAndRelaunch,
  pinNote,
  waitForPinned,
  scrollUntilText,
  subtitleText,
  tapTestID,
  waitForNoteCount,
  waitForSeeded,
  waitForTestID,
  waitForText,
  waitForTextGone,
}
