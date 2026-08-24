/**
 * Process/AppX helpers used by both the Jest environment (before WinAppDriver
 * attaches) and the e2e tests.
 *
 * @format
 */

const {execFileSync, spawn} = require('child_process')
const fs = require('fs')
const path = require('path')

const APP_EXE = 'NitromelonWindows.exe'
const APP_PACKAGE = 'NitromelonWindows'

function taskkill(image) {
  try {
    execFileSync('taskkill', ['/IM', image, '/F'], {stdio: 'ignore'})
  } catch {
    // process already gone
  }
}

function screenWorkArea() {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; ' +
        '$a = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; ' +
        '"$($a.Width),$($a.Height)"',
    ],
    {encoding: 'utf8'},
  ).trim()
  const [width, height] = out.split(',').map(Number)
  if (!width || !height) {
    throw new Error(`Could not determine screen work area from: "${out}"`)
  }
  return {width, height}
}

function packageFamilyName() {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `(Get-AppxPackage -Name ${APP_PACKAGE}).PackageFamilyName`,
    ],
    {encoding: 'utf8'},
  ).trim()
  const name = out.split(/\r?\n/).filter(Boolean).pop()
  if (!name) {
    throw new Error('NitromelonWindows AppX package is not installed')
  }
  return name
}

function localStateDir() {
  return path.join(
    process.env.LOCALAPPDATA,
    'Packages',
    packageFamilyName(),
    'LocalState',
  )
}

function clearAppState() {
  const dir = localStateDir()
  if (!fs.existsSync(dir)) {
    return
  }
  for (const name of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, name), {recursive: true, force: true})
  }
}

function killApp() {
  taskkill(APP_EXE)
}

function killWinAppDriver() {
  taskkill('WinAppDriver.exe')
}

function processRunning(image) {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${image}`, '/NH'],
      {encoding: 'utf8'},
    )
    return out.toLowerCase().includes(image.toLowerCase())
  } catch {
    return false
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function launchApp() {
  const aumid = `${packageFamilyName()}!App`
  // explorer.exe often exits non-zero after handing the AUMID to the shell.
  spawn('explorer.exe', [`shell:AppsFolder\\${aumid}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref()

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (processRunning(APP_EXE)) {
      return
    }
    sleepSync(200)
  }
  throw new Error(`Timed out waiting for ${APP_EXE} to launch`)
}

function prepareFreshLaunch() {
  killWinAppDriver()
  killApp()
  clearAppState()
}

module.exports = {
  APP_PACKAGE,
  clearAppState,
  killApp,
  killWinAppDriver,
  launchApp,
  packageFamilyName,
  prepareFreshLaunch,
  screenWorkArea,
}
