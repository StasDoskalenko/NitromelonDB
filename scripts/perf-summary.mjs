/* eslint-disable no-console */

/**
 * Turns a raw flashlight `flashlight test --resultsFilePath <file>` result
 * (a TestCaseResult: iterations of raw CPU/RAM/FPS samples, unaveraged) into
 * a small summary. Uses @perf-profiler/reporter -- the same library
 * flashlight's own `flashlight report` command uses -- rather than
 * re-deriving CPU/RAM/FPS averaging ourselves.
 *
 * Shared by scripts/post-perf-comment.mjs and scripts/publish-perf-results.mjs.
 */

import fs from 'node:fs'
import {
  averageTestCaseResult,
  getAverageCpuUsage,
  getAverageFPSUsage,
  getAverageRAMUsage,
  getScore,
} from '@perf-profiler/reporter'

export function summarizePerfResult(file) {
  if (!file || !fs.existsSync(file)) return null

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const averaged = averageTestCaseResult(raw)
  const measures = averaged.average.measures

  return {
    iterationCount: raw.iterations.length,
    score: getScore(averaged),
    cpu: Math.round(getAverageCpuUsage(measures) * 10) / 10,
    ram: Math.round(getAverageRAMUsage(measures) ?? 0),
    fps: Math.round((getAverageFPSUsage(measures) ?? 0) * 10) / 10,
  }
}
