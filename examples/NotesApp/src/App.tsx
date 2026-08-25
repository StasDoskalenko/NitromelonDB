import { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { createExampleDatabase } from './database'
import { LoadingScreen } from './screens/LoadingScreen'
import { NotesScreen } from './screens/NotesScreen'
import { SetupErrorScreen } from './screens/SetupErrorScreen'

export default function App() {
  const [session] = useState(() => {
    try {
      return { ok: true as const, db: createExampleDatabase() }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })
  // NotesScreen would actually be safe to render immediately -- every read/write it issues
  // queues correctly until the database's seed step(s) finish (see database.ts's `seed` option).
  // This is purely a UX choice: gating on readyPromise avoids a flash of "0 notes" while the
  // first-launch seed is still running, instead of relying on that queuing invisibly.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!session.ok) {
      return
    }
    let cancelled = false
    session.db.database.readyPromise.then(() => {
      if (!cancelled) {
        setReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [session])

  if (!session.ok) {
    return (
      <KeyboardProvider>
        <SetupErrorScreen message={session.message} />
        <StatusBar style="auto" />
      </KeyboardProvider>
    )
  }

  if (!ready) {
    return (
      <KeyboardProvider>
        <LoadingScreen />
        <StatusBar style="auto" />
      </KeyboardProvider>
    )
  }

  return (
    <KeyboardProvider>
      <NotesScreen db={session.db} />
      <StatusBar style="auto" />
    </KeyboardProvider>
  )
}
