import PerformanceCharts from '@site/src/components/PerformanceCharts'
import Layout from '@theme/Layout'
import React from 'react'

export default function Performance() {
  return (
    <Layout
      title="Performance"
      description="Benchmark history recorded automatically on every merge to master: sync speed against WatermelonDB on iOS, and NotesApp CPU, RAM and FPS on Android."
    >
      <main className="container margin-vert--lg">
        <h1>Performance</h1>
        <p>
          Recorded automatically on every merge to <code>master</code>. Pull requests can get the same numbers as
          an inline comment; this page tracks them over time.
        </p>

        <h2>Sync against WatermelonDB (iOS)</h2>
        <p>
          The <code>examples/benchmark</code> apps&apos; Sync, Realistic sync and Stress cards, as Release builds on
          an iOS simulator on GitHub Actions. Every run also measures WatermelonDB 0.28 with its JSI adapter in the
          same job (dashed line), interleaved run by run. Other VMs on a CI runner slow runs down at random, so each
          point is an app&apos;s best run, and the overall speedup over WatermelonDB JSI (a geometric mean over Sync
          5k, Sync 50k, Realistic sync and the stress test) is the steadiest signal. The runner baseline shows how
          fast each job&apos;s machine was, to compare absolute times across runs. On a pull request, a maintainer can
          comment <code>/perf ios</code> to run it.
        </p>
        <PerformanceCharts
          source="iosSync"
          empty={
            <>
              No runs recorded yet. Data appears here after the first merge to <code>master</code> runs{' '}
              <code>.github/workflows/perf-ios.yml</code>.
            </>
          }
        />

        <h2>NotesApp (Android)</h2>
        <p>
          CPU, RAM, and FPS from the <code>examples/NotesApp</code> example app, via{' '}
          <a href="https://flashlight.dev" target="_blank" rel="noreferrer">
            flashlight
          </a>{' '}
          running <code>maestro/pagination-dynamic.yaml</code> on an Android emulator. Every PR gets these as a
          comment.
        </p>
        <PerformanceCharts
          source="android"
          empty={
            <>
              No runs recorded yet. Data appears here after the first merge to <code>master</code> runs the perf CI
              job (see <code>scripts/ci-notesapp-android-flashlight.sh</code>).
            </>
          }
        />
      </main>
    </Layout>
  )
}
