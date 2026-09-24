#!/usr/bin/env node
// Runs the Sync card on an iOS simulator, relaunching the app before every run, and appends one
// JSON line per run to --out. Needs Maestro and already-installed Release builds of the benchmark
// apps (see ../README.md).
//
//   node scripts/run-sync-trials.mjs \
//     --apps 'NitromelonDB=com.nitromelondb.benchmark;WatermelonDB=com.watermelondb.benchmark' \
//     --sizes 5000,20000,50000 --runs 10 --device <simulator udid> --out results.jsonl
//
// With several apps, runs are interleaved: every round runs each app once per size, in a random
// order, so drift over the session (thermals, simulator background work) hits all apps equally
// instead of whichever one ran last.
//
// Besides the app's own numbers (timings + Hermes heap/GC, see shared/syncBenchmark.ts), it samples
// the app process's resident memory from the host every 100ms. On a simulator the app is a normal
// macOS process, so `ps` can see it. RSS here is a proxy, not the phys_footprint iOS uses for
// memory limits on a device.

import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
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
  for (const required of ['device', 'out']) {
    if (!args[required]) {
      throw new Error(`Missing --${required}`)
    }
  }
  return {
    apps,
    device: args.device,
    out: args.out,
    sizes: (args.sizes ?? '20000').split(',').map(Number),
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

function flowFor(app, size) {
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
- scrollUntilVisible:
    element:
      id: "sync-run"
    direction: DOWN
    timeout: 20000
- tapOn:
    id: "sync-size-${size}"
- tapOn:
    id: "sync-run"
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
      id: "sync-json"
    direction: DOWN
    visibilityPercentage: 10
    timeout: 20000
`
}

function appPid(device, app) {
  const out = execFileSync('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'], {
    encoding: 'utf8',
  })
  const line = out.split('\n').find((row) => row.includes(`UIKitApplication:${app}[`))
  const pid = line ? Number(line.trim().split(/\s+/)[0]) : NaN
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

function rssBytes(pid) {
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

function readResult(device) {
  const hierarchy = execFileSync('maestro', ['--device', device, 'hierarchy'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  // The sync-json Text's content is the only `{"records":...}` string on screen
  const match = hierarchy.match(/\{\\?"records\\?":.*?\\?"memory\\?":(?:null|\{.*?\}\})\}/s)
  if (!match) {
    throw new Error('Could not find the sync-json result in the view hierarchy')
  }
  return JSON.parse(match[0].replace(/\\"/g, '"'))
}

async function runOnce(app, device, size, flowPath) {
  writeFileSync(flowPath, flowFor(app, size))

  let pid = null
  let peak = 0
  let last = 0
  let sampling = true
  const sampler = (async () => {
    while (sampling) {
      pid = pid ?? appPid(device, app)
      const rss = pid ? rssBytes(pid) : null
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
  return { result: readResult(device), rssPeakBytes: peak, rssEndBytes: last }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const flowPath = path.join(mkdtempSync(path.join(tmpdir(), 'sync-trials-')), 'flow.yaml')
  for (let run = 1; run <= options.runs; run += 1) {
    for (const size of options.sizes) {
      for (const { label, app } of shuffled(options.apps)) {
        // eslint-disable-next-line no-await-in-loop
        const { result, rssPeakBytes, rssEndBytes } = await runOnce(app, options.device, size, flowPath)
        const row = { label, app, run, ...result, rssPeakBytes, rssEndBytes }
        appendFileSync(options.out, `${JSON.stringify(row)}\n`)
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
