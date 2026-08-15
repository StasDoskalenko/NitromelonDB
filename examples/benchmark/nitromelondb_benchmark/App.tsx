import { useState } from 'react'
import { BenchmarkScreen } from '../shared/BenchmarkScreen'
import { createNitromelonAdapter } from './database'

const theme = {
  background: '#09090b',
  card: '#18181b',
  accent: '#ea580c',
  accentText: '#fff7ed',
  muted: '#a1a1aa',
  text: '#fafafa',
  danger: '#f87171',
}

export default function App() {
  const [session] = useState(() => {
    try {
      return { ok: true as const, adapter: createNitromelonAdapter() }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  return (
    <BenchmarkScreen
      title="NitromelonDB"
      subtitle="Push the Nitro SQLite adapter through 1,000,000 writes, queries, and removals."
      adapter={session.ok ? session.adapter : null}
      setupError={session.ok ? null : session.message}
      theme={theme}
    />
  )
}
