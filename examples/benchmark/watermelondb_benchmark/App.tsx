import { useState } from 'react'
import { BenchmarkScreen } from '../shared/BenchmarkScreen'
import { createWatermelonAdapter } from './database'
import { MassDeleteBenchmarkCard } from './MassDeleteBenchmarkCard'
import { SyncBenchmarkCard } from '../shared/SyncBenchmarkCard'
import { runSync } from './syncBenchmark'
import { IncrementalSyncCard } from '../shared/IncrementalSyncCard'
import { runIncrementalSync } from './incrementalSyncBenchmark'
import { RealisticSyncCard } from '../shared/RealisticSyncCard'
import { runRealisticSync } from './realisticSyncBenchmark'

const theme = {
  background: '#0b1210',
  card: '#16201c',
  accent: '#e11d48',
  accentText: '#fff1f2',
  muted: '#a3b5ad',
  text: '#f8fafc',
  danger: '#fb7185',
}

export default function App() {
  const [session] = useState(() => {
    try {
      return { ok: true as const, adapter: createWatermelonAdapter() }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  return (
    <BenchmarkScreen
      title="WatermelonDB"
      subtitle="Same 1,000,000 write / query / delete loop against upstream WatermelonDB."
      adapter={session.ok ? session.adapter : null}
      setupError={session.ok ? null : session.message}
      theme={theme}
    >
      <SyncBenchmarkCard theme={theme} run={runSync} />
      <IncrementalSyncCard theme={theme} run={runIncrementalSync} />
      <RealisticSyncCard theme={theme} run={runRealisticSync} />
      <MassDeleteBenchmarkCard theme={theme} />
    </BenchmarkScreen>
  )
}
