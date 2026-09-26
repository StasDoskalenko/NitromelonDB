#!/usr/bin/env node
// Runs the Sync card (or, with --card incr, the Incremental sync card) on an iOS simulator or an
// Android device/emulator, relaunching the app before every run, and appends one JSON line per run
// to --out. Needs Maestro and already-installed Release builds of the benchmark apps (see
// ../README.md).
//
//   node scripts/run-sync-trials.mjs \
//     --apps 'NitromelonDB=com.nitromelondb.benchmark;WatermelonDB=com.watermelondb.benchmark' \
//     --sizes 5000,20000,50000 --runs 10 --device <simulator udid> --out results.jsonl
//
//   node scripts/run-sync-trials.mjs --platform android --device emulator-5554 --card incr \
//     --apps '…' --sizes 2000 --runs 10 --out incremental.jsonl
//
// --sizes picks the card's size chip: records for Sync, records per table for Incremental sync,
// pulls for Realistic sync (--card real; needs mock-server/server.mjs running, and on Android
// `adb reverse tcp:8787 tcp:8787`).
//
// With several apps, runs are interleaved: every round runs each app once per size, in a random
// order, so drift over the session (thermals, simulator background work) hits all apps equally
// instead of whichever one ran last.
//
// Besides the app's own numbers (timings + Hermes heap/GC, see shared/syncBenchmark.ts), it samples
// the app process's resident memory from the host every 100ms. On a simulator the app is a normal
// macOS process, so `ps` can see it. RSS here is a proxy, not the phys_footprint iOS uses for
// memory limits on a device. On Android it's VmRSS from /proc via adb.

import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1]
  }
  const apps = args.apps
    ? args.apps.split(';').map((entry) => {
        const at = entry.lastIndexOf('=')
        return { label: entry.slice(0, at).trim(), app: entry.slice(at + 1).trim() }
      })
    : [{ label: args.label, app: args.app }]
  if (apps.some(({ label, app }) => !label || !app)) {
    throw new Error("Pass --apps 'Label=bundle.id;…' or --app with --label")
  }
  const platform = args.platform ?? 'ios'
  if (!['ios', 'android'].includes(platform)) {
    throw new Error('--platform must be ios or android')
  }
  const card = args.card ?? 'sync'
  if (!['sync', 'incr', 'real'].includes(card)) {
    throw new Error('--card must be sync, incr or real')
  }
  for (const required of ['device', 'out']) {
    if (!args[required]) {
      throw new Error(`Missing --${required}`)
    }
  }
  return {
    apps,
    platform,
    card,
    device: args.device,
    out: args.out,
    sizes: (args.sizes ?? { sync: '20000', incr: '2000', real: '300' }[card]).split(',').map(Number),
    runs: Number(args.runs ?? 5),
  }
}

function shuffled(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function flowFor(app, card, size) {
  return `appId: ${app}
---
- launchApp:
    stopApp: true
- extendedWaitUntil:
    visible: "Cancel"
    timeout: 3000
    optional: true
- tapOn:
    text: "Cancel"
    optional: true
# expo run:ios can leave a late "Open in …?" deep-link prompt behind
- waitForAnimationToEnd:
    timeout: 2000
- tapOn:
    text: "Cancel"
    optional: true
- scrollUntilVisible:
    element:
      id: "${card}-run"
    direction: DOWN
    timeout: 20000
- tapOn:
    id: "${card}-size-${size}"
- tapOn:
    id: "${card}-run"
- extendedWaitUntil:
    visible: "Running…"
    timeout: 5000
    optional: true
- extendedWaitUntil:
    notVisible: "Running…"
    timeout: 900000
# the iOS view hierarchy only lists on-screen elements
- scrollUntilVisible:
    element:
      id: "${card}-json"
    direction: DOWN
    visibilityPercentage: 10
    timeout: 20000
`
}

const adb = (device, ...args) =>
  execFileSync('adb', ['-s', device, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

function appPid(platform, device, app) {
  if (platform === 'android') {
    try {
      const pid = Number(adb(device, 'shell', 'pidof', app).trim().split(/\s+/)[0])
      return Number.isFinite(pid) && pid > 0 ? pid : null
    } catch {
      return null // pidof exits 1 while the app isn't running
    }
  }
  const out = execFileSync('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'], {
    encoding: 'utf8',
  })
  const line = out.split('\n').find((row) => row.includes(`UIKitApplication:${app}[`))
  const pid = line ? Number(line.trim().split(/\s+/)[0]) : NaN
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

function rssBytes(platform, device, pid) {
  if (platform === 'android') {
    try {
      const status = adb(device, 'shell', 'cat', `/proc/${pid}/status`)
      const kb = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1])
      return Number.isFinite(kb) && kb > 0 ? kb * 1024 : null
    } catch {
      return null
    }
  }
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })) * 1024
  } catch {
    return null
  }
}

function runMaestro(device, flowPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('maestro', ['--device', device, 'test', flowPath], { stdio: 'pipe' })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`maestro exited ${code}:\n${output.slice(-2000)}`)),
    )
  })
}

// The card's `<card>-json` Text holds the result. Android's hierarchy has it as `resource-id` +
// `text`; iOS's as `identifier` + `label`/`value`, so look for the node by id either way.
function findTextById(node, id) {
  const attributes = node?.attributes ?? {}
  if (attributes['resource-id'] === id || attributes.identifier === id) {
    return attributes.text || attributes.label || attributes.value || attributes.accessibilityText
  }
  for (const child of node?.children ?? []) {
    const found = findTextById(child, id)
    if (found) {
      return found
    }
  }
  return null
}

function readResult(device, card) {
  const hierarchy = execFileSync('maestro', ['--device', device, 'hierarchy'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  let text = null
  try {
    text = findTextById(JSON.parse(hierarchy.slice(hierarchy.indexOf('{'))), `${card}-json`)
  } catch {
    // not plain JSON (older Maestro): fall back to the regex below
  }
  if (!text && card === 'sync') {
    // The sync-json Text's content is the only `{"records":...}` string on screen
    const match = hierarchy.match(/\{\\?"records\\?":.*?\\?"memory\\?":(?:null|\{.*?\}\})\}/s)
    text = match?.[0].replace(/\\"/g, '"')
  }
  if (!text) {
    throw new Error(`Could not find the ${card}-json result in the view hierarchy`)
  }
  return JSON.parse(text)
}

// Every run starts from a brand-new database file. unsafeResetDatabase() empties tables but keeps
// the file, its free pages, and the WAL, so without this a run's timing depended on what earlier
// runs (of other sizes) left behind -- enough to show up as a few ms on small workloads.
// On Android, Release builds can't be `run-as`, so clear all the app's data instead.
function deleteSyncDatabases(platform, device, app) {
  if (platform === 'android') {
    adb(device, 'shell', 'pm', 'clear', app)
    return
  }
  try {
    execFileSync('xcrun', ['simctl', 'terminate', device, app], { stdio: 'ignore' })
  } catch {
    // not running
  }
  const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, app, 'data'], {
    encoding: 'utf8',
  }).trim()
  const documents = path.join(container, 'Documents')
  for (const file of existsSync(documents) ? readdirSync(documents) : []) {
    if (/(-(sync|incr)|^realistic-\d+)\.db(-wal|-shm|-journal)?$/.test(file)) {
      rmSync(path.join(documents, file))
    }
  }
}

async function runOnce({ platform, card, device }, app, size, flowPath) {
  writeFileSync(flowPath, flowFor(app, card, size))
  deleteSyncDatabases(platform, device, app)

  let pid = null
  let peak = 0
  let last = 0
  let sampling = true
  const sampler = (async () => {
    while (sampling) {
      pid = pid ?? appPid(platform, device, app)
      const rss = pid ? rssBytes(platform, device, pid) : null
      if (rss) {
        peak = Math.max(peak, rss)
        last = rss
      } else {
        pid = null // relaunched: pick up the new process
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(100)
    }
  })()

  try {
    await runMaestro(device, flowPath)
  } finally {
    sampling = false
    await sampler
  }
  return { result: readResult(device, card), rssPeakBytes: peak, rssEndBytes: last }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const flowPath = path.join(mkdtempSync(path.join(tmpdir(), 'sync-trials-')), 'flow.yaml')
  for (let run = 1; run <= options.runs; run += 1) {
    for (const size of options.sizes) {
      for (const { label, app } of shuffled(options.apps)) {
        // A flow can fail before the benchmark starts (a system prompt in the way). Retry once, so
        // one flaky launch doesn't end the session, and log it so no run is dropped silently.
        let outcome
        for (let attempt = 1; !outcome; attempt += 1) {
          try {
            // eslint-disable-next-line no-await-in-loop
            outcome = await runOnce(options, app, size, flowPath)
          } catch (error) {
            if (attempt >= 2) {
              throw error
            }
            console.log(`${label} ${size} #${run}: attempt ${attempt} failed, retrying (${String(error).split('\n')[0]})`)
          }
        }
        const { result, rssPeakBytes, rssEndBytes } = outcome
        const row = { label, app, run, platform: options.platform, ...result, rssPeakBytes, rssEndBytes }
        appendFileSync(options.out, `${JSON.stringify(row)}\n`)
        if (result.kind === 'realistic') {
          console.log(
            `${label} ${size} pulls #${run}: total ${Math.round(result.totalMs)}ms, ` +
              `library ${Math.round(result.libraryMs)}ms, network ${Math.round(result.networkMs)}ms, ` +
              `parse ${Math.round(result.parseMs)}ms, open ${Math.round(result.openMs)}ms, ` +
              `rss peak ${Math.round(rssPeakBytes / 1048576)}MB`,
          )
          continue
        }
        if (result.kind === 'incremental') {
          console.log(
            `${label} ${size}/table #${run}: pulls ${Math.round(result.plain.totalMs)}ms ` +
              `(empty ${result.plain.empty.medianMs.toFixed(1)}ms), observed ${Math.round(result.observed.totalMs)}ms ` +
              `(empty ${result.observed.empty.medianMs.toFixed(1)}ms), rss peak ${Math.round(rssPeakBytes / 1048576)}MB`,
          )
          continue
        }
        console.log(
          `${label} ${size} #${run}: total ${Math.round(result.totalMs)}ms, ` +
            `gc ${Math.round(result.memory?.gcMs ?? 0)}ms, ` +
            `heap peak ${Math.round((result.memory?.heapPeakBytes ?? 0) / 1048576)}MB, ` +
            `rss peak ${Math.round(rssPeakBytes / 1048576)}MB`,
        )
      }
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
