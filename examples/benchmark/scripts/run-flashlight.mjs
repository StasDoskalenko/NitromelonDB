#!/usr/bin/env node
// Measures the Sync or Incremental sync card with Flashlight (https://github.com/bamlab/flashlight)
// on Android: CPU per thread, RAM and FPS sampled from the device while the card runs. Complements
// run-sync-trials.mjs, which records the app's own timings.
//
//   node scripts/run-flashlight.mjs --device emulator-5554 --card incr --size 2000 \
//     --apps 'NitromelonDB=com.nitromelondb.benchmark;WatermelonDB=com.watermelondb.benchmark' \
//     --rounds 6 --per-round 5 --out-dir flashlight-results
//
// Flashlight runs one app's iterations back to back, so apps are interleaved in rounds instead:
// every round runs `--per-round` iterations of each app, in a random order. Each iteration starts
// from cleared app data (a fresh database). At the end, every app's iterations are merged into
// one `<label>.json` for `flashlight report`, and a per-iteration summary goes to summary.jsonl.
// Needs `flashlight`, `maestro` and `adb` on PATH, and installed Release builds.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1]
  }
  for (const required of ['apps', 'device', 'out-dir']) {
    if (!args[required]) {
      throw new Error(`Missing --${required}`)
    }
  }
  const card = args.card ?? 'incr'
  return {
    apps: args.apps.split(';').map((entry) => {
      const at = entry.lastIndexOf('=')
      return { label: entry.slice(0, at).trim(), app: entry.slice(at + 1).trim() }
    }),
    card,
    size: Number(args.size ?? (card === 'incr' ? 2000 : 20000)),
    device: args.device,
    outDir: args['out-dir'],
    rounds: Number(args.rounds ?? 6),
    perRound: Number(args['per-round'] ?? 5),
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

// Android-only flow: launch, pick the size, run, wait until the card is done
function flowFor(app, card, size) {
  return `appId: ${app}
---
- launchApp:
    stopApp: true
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
- scrollUntilVisible:
    element:
      id: "${card}-json"
    direction: DOWN
    visibilityPercentage: 10
    timeout: 20000
`
}

const slug = (label) => label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

// Flashlight's result JSON: { name, status, iterations: [{ time, status, measures: [{ time, cpu:
// { perName: { thread: % }, perCore }, ram, fps }] }] }. Summarize each iteration as CPU time used
// (seconds of one core, summed over threads and samples -- unlike mean CPU %, it doesn't depend on
// how long the flow idles around the work), the same for the JS thread, peak CPU and peak RAM.
function summarizeIteration(iteration) {
  const measures = iteration.measures ?? []
  const totals = measures.map((m) =>
    Object.values(m.cpu?.perName ?? {}).reduce((sum, value) => sum + value, 0),
  )
  const jsThread = measures.map((m) => {
    const perName = m.cpu?.perName ?? {}
    const name = Object.keys(perName).find((thread) => /mqt_(v_)?js/.test(thread))
    return name ? perName[name] : 0
  })
  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
  // Each sample covers the time since the previous one (~500ms)
  const cpuSeconds = (percents) =>
    percents.reduce((sum, percent, i) => {
      const interval = i ? measures[i].time - measures[i - 1].time : (measures[0]?.time ?? 0)
      return sum + (percent / 100) * (interval / 1000)
    }, 0)
  const ram = measures.map((m) => m.ram ?? 0)
  const fps = measures.map((m) => m.fps).filter((value) => typeof value === 'number')
  return {
    durationMs: iteration.time,
    samples: measures.length,
    cpuSeconds: cpuSeconds(totals),
    jsThreadCpuSeconds: cpuSeconds(jsThread),
    cpuMean: mean(totals),
    cpuPeak: Math.max(0, ...totals),
    jsThreadCpuMean: mean(jsThread),
    ramPeakMb: Math.max(0, ...ram),
    fpsMean: mean(fps),
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  mkdirSync(options.outDir, { recursive: true })
  const merged = new Map()

  for (let round = 1; round <= options.rounds; round += 1) {
    for (const { label, app } of shuffled(options.apps)) {
      const flowPath = path.join(options.outDir, `flow-${slug(label)}.yaml`)
      writeFileSync(flowPath, flowFor(app, options.card, options.size))
      const resultsPath = path.join(options.outDir, `${slug(label)}-round${round}.json`)
      execFileSync(
        'flashlight',
        [
          'test',
          '--bundleId',
          app,
          '--testCommand',
          `maestro --device ${options.device} test ${flowPath}`,
          '--beforeEachCommand',
          `adb -s ${options.device} shell pm clear ${app}`,
          '--skipRestart',
          '--iterationCount',
          String(options.perRound),
          '--resultsFilePath',
          resultsPath,
          '--resultsTitle',
          label,
          '--logLevel',
          'error',
        ],
        { stdio: 'inherit' },
      )
      const result = JSON.parse(readFileSync(resultsPath, 'utf8'))
      // Failed attempts (Flashlight retries them) stay in the file; only count the successful ones
      const iterations = (result.iterations ?? []).filter(
        (iteration) => iteration.status === 'SUCCESS',
      )
      for (const iteration of iterations) {
        const row = {
          label,
          app,
          card: options.card,
          size: options.size,
          round,
          ...summarizeIteration(iteration),
        }
        appendFileSync(path.join(options.outDir, 'summary.jsonl'), `${JSON.stringify(row)}\n`)
      }
      const combined = merged.get(label) ?? { ...result, name: label, iterations: [] }
      combined.iterations.push(...iterations)
      merged.set(label, combined)
      console.log(`${label} round ${round}: ${iterations.length} iterations`)
    }
  }

  for (const [label, result] of merged) {
    writeFileSync(path.join(options.outDir, `${slug(label)}.json`), JSON.stringify(result))
  }
}

main()
