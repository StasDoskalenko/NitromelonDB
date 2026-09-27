import { useState } from 'react'
import { BenchmarkScreen } from '../shared/BenchmarkScreen'
import { CompetingWorkBenchmarkCard } from '../shared/CompetingWorkBenchmarkCard'
import { Home, type BenchmarkTile } from '../shared/Home'
import { IncrementalSyncCard } from '../shared/IncrementalSyncCard'
import { RealisticSyncCard } from '../shared/RealisticSyncCard'
import { Screen } from '../shared/Screen'
import { SyncBenchmarkCard } from '../shared/SyncBenchmarkCard'
import { createWatermelonAdapter } from './database'
import { runCompeting } from './competingWorkBenchmark'
import { runIncrementalSync } from './incrementalSyncBenchmark'
import { MassDeleteBenchmarkCard } from './MassDeleteBenchmarkCard'
import { runRealisticSync } from './realisticSyncBenchmark'
import { runSync } from './syncBenchmark'

const theme = {
  background: '#0b1210',
  card: '#16201c',
  accent: '#e11d48',
  accentText: '#fff1f2',
  muted: '#a3b5ad',
  text: '#f8fafc',
  danger: '#fb7185',
}

const TILES: BenchmarkTile[] = [
  {
    key: 'main',
    label: 'Write / query / delete',
    description: '1,000,000 writes, queries, and permanent deletes, repeated 20 times.',
  },
  {
    key: 'sync',
    label: 'Sync',
    description: 'Real synchronize() against a 12-column table: create, update, fetch, push.',
  },
  {
    key: 'incrementalSync',
    label: 'Incremental sync',
    description: 'Many small synchronize() calls into a database that already has data.',
  },
  {
    key: 'realisticSync',
    label: 'Realistic sync',
    description: 'Initial sync of a fresh install from a local mock server, page by page.',
  },
  {
    key: 'competing',
    label: 'Competing writers/readers',
    description: 'Several uncoordinated writer/reader callers at once -- counts queue warnings.',
  },
  {
    key: 'massDelete',
    label: 'Mass delete (reference)',
    description: "destroyAllPermanently() timing -- upstream has no destroyMatching() to compare.",
  },
]

type ScreenKey = (typeof TILES)[number]['key'] | null

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
  const [screen, setScreen] = useState<ScreenKey>(null)
  const home = () => setScreen(null)

  if (screen === 'main') {
    return (
      <BenchmarkScreen
        title="WatermelonDB"
        subtitle="Same 1,000,000 write / query / delete loop against upstream WatermelonDB."
        adapter={session.ok ? session.adapter : null}
        setupError={session.ok ? null : session.message}
        theme={theme}
        onBack={home}
      />
    )
  }
  if (screen === 'sync') {
    return (
      <Screen title="Sync" theme={theme} onBack={home}>
        <SyncBenchmarkCard theme={theme} run={runSync} />
      </Screen>
    )
  }
  if (screen === 'incrementalSync') {
    return (
      <Screen title="Incremental sync" theme={theme} onBack={home}>
        <IncrementalSyncCard theme={theme} run={runIncrementalSync} />
      </Screen>
    )
  }
  if (screen === 'realisticSync') {
    return (
      <Screen title="Realistic sync" theme={theme} onBack={home}>
        <RealisticSyncCard theme={theme} run={runRealisticSync} />
      </Screen>
    )
  }
  if (screen === 'competing') {
    return (
      <Screen title="Competing writers/readers" theme={theme} onBack={home}>
        <CompetingWorkBenchmarkCard theme={theme} run={runCompeting} />
      </Screen>
    )
  }
  if (screen === 'massDelete') {
    return (
      <Screen title="Mass delete (reference)" theme={theme} onBack={home}>
        <MassDeleteBenchmarkCard theme={theme} />
      </Screen>
    )
  }

  return (
    <Home
      title="WatermelonDB"
      subtitle="Same 1,000,000 write / query / delete loop against upstream WatermelonDB."
      engine={session.ok ? session.adapter.engine : null}
      setupError={session.ok ? null : session.message}
      theme={theme}
      tiles={TILES}
      onSelect={(key) => setScreen(key as ScreenKey)}
    />
  )
}
