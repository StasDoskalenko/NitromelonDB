import PerformanceCharts from '@site/src/components/PerformanceCharts'
import Layout from '@theme/Layout'
import React from 'react'

export default function Performance() {
  return (
    <Layout
      title="Performance"
      description="NotesApp CPU, RAM, and FPS benchmark history, recorded automatically on every merge to master."
    >
      <main className="container margin-vert--lg">
        <h1>Performance</h1>
        <p>
          CPU, RAM, and FPS recorded from the <code>examples/NotesApp</code> example app on every merge to{' '}
          <code>master</code>, via{' '}
          <a href="https://flashlight.dev" target="_blank" rel="noreferrer">
            flashlight
          </a>{' '}
          running <code>maestro/pagination-dynamic.yaml</code> on a real Android emulator (iOS coming later). Pull
          requests get the same numbers as an inline comment; this page tracks them over time.
        </p>
        <PerformanceCharts />
      </main>
    </Layout>
  )
}
