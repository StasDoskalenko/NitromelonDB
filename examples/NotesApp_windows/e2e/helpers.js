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

async function noteCount() {
  const match = (await subtitleText()).match(/(\d+) notes?/)
  return match ? parseInt(match[1], 10) : null
}

async function waitForNoteCount(count, timeout = 60000) {
  await app.waitUntil(async () => (await noteCount()) === count, {
    timeout,
    timeoutMsg: `Did not reach ${count} notes`,
  })
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

// title-input is a normal controlled TextInput (value={title}) on every
// platform — see NotesComposer.tsx. It used to be uncontrolled on Windows
// only, worked around with a shadow ref and a dual Enter/button submit path,
// because the old PowerShell SendKeys mechanism dropped lowercase characters
// (see CHANGELOG). That's a WinAppDriver SendKeys bug, not a reason to change
// the production component; browser.keys() doesn't have it. With a real
// controlled input, typing and submitting work the same way Maestro drives
// this input on iOS/Android: click, type, submit, verify — retry the whole
// cycle (same pattern as pinNote/isPinned) if it didn't land.
async function addNote(title, timeout = 15000) {
  const nextCount = ((await noteCount()) ?? 0) + 1
  await app.waitUntil(
    async () => {
      if ((await noteCount()) === nextCount) {
        return true
      }
      try {
        const input = await app.findElementByTestID('title-input')
        await input.click()
        await browser.keys(Array(title.length + 10).fill('Backspace'))
        await browser.keys(title.split(''))
        await browser.keys(['Enter'])
        await sleep(400)
        return (await noteCount()) === nextCount
      } catch {
        return false
      }
    },
    {timeout, timeoutMsg: `Did not reach ${nextCount} notes`},
  )
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

// Unlike pinNote, this used to be a single click with no verification —
// exactly the class of issue addNote/pinNote already had to work around
// (WinAppDriver clicks can land without the app registering them). Retry
// until the note is actually gone, same pattern as pinNote/isPinned.
async function deleteNote(title, timeout = 15000) {
  await app.waitUntil(
    async () => {
      if (!(await textVisible(title))) {
        return true
      }
      try {
        const el = await app.findElementByTestID(actionTestID('delete', title))
        await el.click()
        await sleep(400)
        return !(await textVisible(title))
      } catch {
        return false
      }
    },
    {timeout, timeoutMsg: `${title} was not deleted`},
  )
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
