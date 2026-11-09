#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * A fixed workload that measures how fast the machine running the benchmark is, so results can be
 * compared across CI jobs, which land on different runners. Within one job, WatermelonDB JSI is the
 * baseline (it runs the same workload in the same job); this one is for comparing jobs with each
 * other, e.g. a master run's absolute times against last month's. scripts/ci-benchmark-ios.sh runs
 * it before and after the benchmark, and ios-sync-summary.mjs keeps the best of all of them.
 *
 * Two parts, each repeated and reported as its best run (slowdowns from other VMs on the host only
 * ever add time):
 * - js: allocation, JSON, sorting and string hashing, single-threaded
 * - sqlite: a file database in WAL mode (node:sqlite, no dependencies), shaped like the benchmark
 *   apps' work: inserts in batches of 2,000, filtered counts, a sorted page and deletes
 *
 * Usage: node scripts/runner-baseline.mjs [repeats, default 5]   (prints JSON)
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

// Deterministic, so every run does the same work
function prng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function jsWorkload() {
  const random = prng(42)
  const rows = []
  for (let i = 0; i < 200_000; i++) {
    rows.push({
      id: `r${i}`,
      value: Math.floor(random() * 1000),
      score: random(),
      name: `name ${i}`,
    })
  }
  const parsed = JSON.parse(JSON.stringify(rows))
  parsed.sort((a, b) => a.value - b.value || a.score - b.score)
  let hash = 2166136261
  for (const row of parsed) {
    for (let i = 0; i < row.name.length; i++) {
      hash = Math.imul(hash ^ row.name.charCodeAt(i), 16777619)
    }
  }
  return hash
}

async function sqliteWorkload(DatabaseSync) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-baseline-'))
  const db = new DatabaseSync(path.join(dir, 'baseline.db'))
  try {
    db.exec('pragma journal_mode = WAL')
    db.exec(
      'create table items (id text primary key, value integer, created_at integer, score real, name text, flag integer)',
    )
    const insert = db.prepare('insert into items values (?, ?, ?, ?, ?, ?)')
    const random = prng(7)
    for (let start = 0; start < 50_000; start += 2_000) {
      db.exec('begin')
      for (let i = start; i < start + 2_000; i++) {
        insert.run(
          `i${i}`,
          Math.floor(random() * 1000),
          1_700_000_000_000 + i,
          random(),
          `item ${i}`,
          i % 2,
        )
      }
      db.exec('commit')
    }
    for (let round = 0; round < 5; round++) {
      db.prepare('select count(*) as n from items where value = 42').get()
      db.prepare('select count(*) as n from items where value >= 990').get()
      db.prepare('select * from items where value = 42').all()
      db.prepare('select * from items order by created_at desc limit 100').all()
    }
    db.exec('begin')
    db.exec('delete from items')
    db.exec('commit')
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function timed(fn) {
  const started = performance.now()
  fn()
  return performance.now() - started
}

async function main() {
  const repeats = Number(process.argv[2] ?? 5)
  const { DatabaseSync } = await import('node:sqlite')
  jsWorkload() // warm up the JIT, so the first timed run isn't an outlier for a different reason
  const js = []
  const sqlite = []
  for (let i = 0; i < repeats; i++) {
    js.push(timed(jsWorkload))
    const started = performance.now()
    await sqliteWorkload(DatabaseSync)
    sqlite.push(performance.now() - started)
  }
  const round = (ms) => Math.round(ms * 10) / 10
  console.log(
    JSON.stringify({
      jsMs: round(Math.min(...js)),
      sqliteMs: round(Math.min(...sqlite)),
      runs: { js: js.map(round), sqlite: sqlite.map(round) },
      node: process.version,
      cpu: os.cpus()[0]?.model ?? null,
      cores: os.cpus().length,
    }),
  )
}

main()
