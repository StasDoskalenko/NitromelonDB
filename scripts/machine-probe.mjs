#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * A short hardware probe of the machine running the iOS benchmark, with open-source tools: how fast
 * its CPU, memory, disk and GPU are at this moment. examples/benchmark/scripts/run-sync-trials.mjs
 * runs it before the first round and after every round (--probe), so each run of the apps has a
 * probe taken a minute or two before and after it. Other VMs on a CI runner slow the machine down
 * for minutes at a time, so a probe only says something about runs close to it in time (two runs
 * of scripts/runner-baseline.mjs in one job differed by up to 2x). scripts/machine-probe-analysis.mjs
 * then checks how well each part tracks the apps' run-to-run swings.
 *
 * Each part takes 1-4 s; a probe takes ~15 s. Every number is higher = faster:
 * - cpu1Mips, cpuAllMips: 7-Zip's built-in benchmark (LZMA compression and decompression, integer
 *   and memory-latency heavy like a database), on one thread and on every core. (sysbench's CPU
 *   test is broken on Apple silicon: the loop gets optimized away.)
 * - memMiBps: sysbench memory, sequential 1 MiB writes, one thread
 * - fsyncIops: fio, 4k random writes with an fsync after each, the way SQLite commits
 * - randReadIops: fio, 4k random reads past the page cache (direct I/O)
 * - gpuGflops: a Metal compute kernel (scripts/machine-probe/gpu.swift; no open-source Metal CLI
 *   benchmark does just this)
 * A part that fails (tool missing, no Metal device) is null.
 *
 * Usage: node scripts/machine-probe.mjs <workDir> [threads]   (prints one JSON line)
 *   Needs 7zz (Homebrew sevenzip), sysbench and fio; swiftc for the GPU part.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function attempt(fn) {
  try {
    const value = fn()
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null
  } catch {
    return null
  }
}

// 7-Zip's "Tot:" line ends with the total rating in MIPS
function sevenZip(threads) {
  const out = run('7zz', ['b', '1', `-mmt${threads}`, '-md18'])
  const total = out.split('\n').find((line) => line.startsWith('Tot:'))
  return Number(total.trim().split(/\s+/).pop())
}

function memory() {
  const out = run('sysbench', [
    'memory',
    '--memory-block-size=1M',
    '--memory-total-size=1000G',
    '--threads=1',
    '--time=1',
    'run',
  ])
  return Number(/\(([\d.]+) MiB\/sec\)/.exec(out)[1])
}

function fio(dir, name, args, side) {
  const out = run('fio', [
    `--name=${name}`,
    `--directory=${dir}`,
    '--bs=4k',
    '--runtime=2',
    '--time_based',
    '--output-format=json',
    ...args,
  ])
  return JSON.parse(out).jobs[0][side].iops
}

function gpu(dir) {
  const binary = path.join(dir, 'gpu-probe')
  if (!fs.existsSync(binary)) {
    run('swiftc', ['-O', path.join(HERE, 'machine-probe', 'gpu.swift'), '-o', binary])
  }
  return JSON.parse(run(binary, [])).gpuGflops
}

export function probe(dir, threads = os.cpus().length) {
  fs.mkdirSync(dir, { recursive: true })
  const startedAt = Date.now()
  const result = {
    cpu1Mips: attempt(() => sevenZip(1)),
    cpuAllMips: attempt(() => sevenZip(threads)),
    memMiBps: attempt(memory),
    fsyncIops: attempt(() =>
      fio(dir, 'fsync', ['--size=64m', '--rw=randwrite', '--fsync=1'], 'write'),
    ),
    randReadIops: attempt(() =>
      fio(dir, 'randread', ['--size=256m', '--rw=randread', '--direct=1'], 'read'),
    ),
    gpuGflops: attempt(() => gpu(dir)),
  }
  return { at: startedAt, durationMs: Date.now() - startedAt, ...result }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, threads] = process.argv.slice(2)
  if (!dir) {
    console.error('Usage: node scripts/machine-probe.mjs <workDir> [threads]')
    process.exit(1)
  }
  console.log(JSON.stringify(probe(dir, threads ? Number(threads) : undefined)))
}
