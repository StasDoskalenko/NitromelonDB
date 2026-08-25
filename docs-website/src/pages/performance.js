import PerformanceCharts from '@site/src/components/PerformanceCharts'
import Layout from '@theme/Layout'
import React from 'react'

export default function Performance() {
  return (
    <Layout
      title="Performance"
      description="NotesApp CPU, memory, and FPS benchmark history, recorded automatically on every merge to master."
    >
      <main className="container margin-vert--lg">
        <h1>Performance</h1>
        <p>
          CPU, memory, and FPS recorded from the <code>examples/NotesApp</code> example app on every merge to{' '}
          <code>master</code>. Each point is one run of <code>maestro/perf-run.yaml</code> — a mix of note
          insert/pin/delete churn and a full pagination scroll — driven by CI on a real Android emulator and iOS
          simulator. Pull requests get the same numbers as an inline comment; this page tracks them over time.
        </p>
        <PerformanceCharts />
      </main>
    </Layout>
  )
}
