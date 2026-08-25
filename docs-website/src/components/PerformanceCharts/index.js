import useBaseUrl from '@docusaurus/useBaseUrl'
import React, { useEffect, useState } from 'react'
import { MetricChart } from './MetricChart'
import styles from './styles.module.css'

/**
 * Renders NotesApp perf-benchmark history (one point per merge to master,
 * appended by the perf-publish CI job) fetched client-side from the static
 * JSON synced onto this branch by scripts/update-docusaurus at build time.
 */
export default function PerformanceCharts() {
  const dataUrl = useBaseUrl('/data/benchmarks.json')
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(dataUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setHistory(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [dataUrl])

  if (error != null) {
    return <p className={styles.empty}>Couldn&apos;t load benchmark history: {error}</p>
  }

  if (history == null) {
    return <p className={styles.empty}>Loading benchmark history…</p>
  }

  if (history.length === 0) {
    return (
      <p className={styles.empty}>
        No benchmark runs recorded yet. Data appears here after the first merge to <code>master</code> runs the perf
        CI jobs (see <code>maestro/perf-run.yaml</code> in <code>examples/NotesApp</code>).
      </p>
    )
  }

  return (
    <div className={styles.grid}>
      <MetricChart history={history} metric="cpu" label="CPU usage" unit="%" />
      <MetricChart history={history} metric="memory" label="Memory usage" unit="MB" />
      <MetricChart history={history} metric="jsFps" label="JS FPS" unit="fps" />
      <MetricChart history={history} metric="uiFps" label="UI FPS" unit="fps" />
    </div>
  )
}
