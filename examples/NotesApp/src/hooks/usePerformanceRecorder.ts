import { useCallback, useRef, useState } from 'react'
import {
  getCpuUsage,
  getJsFps,
  getMemoryUsage,
  getUiFps,
} from 'react-native-performance-toolkit'

const SAMPLE_INTERVAL_MS = 500

type Sample = {
  cpu: number
  memory: number
  jsFps: number
  uiFps: number
}

type MetricStats = { avg: number; min: number; max: number }

export type PerformanceSummary = {
  durationMs: number
  sampleCount: number
  cpu: MetricStats
  memory: MetricStats
  jsFps: MetricStats
  uiFps: MetricStats
}

function summarize(values: number[]): MetricStats {
  if (values.length === 0) {
    return { avg: 0, min: 0, max: 0 }
  }
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    avg: Number((sum / values.length).toFixed(2)),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

/**
 * Polls react-native-performance-toolkit's non-hook getters on an interval instead of
 * using its React hooks, so recording doesn't trigger re-renders across the tree it's
 * mounted in.
 */
export function usePerformanceRecorder() {
  const samplesRef = useRef<Sample[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const [summary, setSummary] = useState<PerformanceSummary | null>(null)

  const start = useCallback(() => {
    if (intervalRef.current != null) {
      return
    }
    samplesRef.current = []
    startedAtRef.current = Date.now()
    setSummary(null)
    intervalRef.current = setInterval(() => {
      samplesRef.current.push({
        cpu: getCpuUsage(),
        memory: getMemoryUsage(),
        jsFps: getJsFps(),
        uiFps: getUiFps(),
      })
    }, SAMPLE_INTERVAL_MS)
  }, [])

  const stop = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    const samples = samplesRef.current
    const result: PerformanceSummary = {
      durationMs: Date.now() - startedAtRef.current,
      sampleCount: samples.length,
      cpu: summarize(samples.map((sample) => sample.cpu)),
      memory: summarize(samples.map((sample) => sample.memory)),
      jsFps: summarize(samples.map((sample) => sample.jsFps)),
      uiFps: summarize(samples.map((sample) => sample.uiFps)),
    }
    setSummary(result)
    return result
  }, [])

  return { start, stop, summary }
}
