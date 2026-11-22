import { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { useDatabaseReady } from 'nitromelondb/hooks'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { createExampleDatabase } from './database'
import { LoadingScreen } from './screens/LoadingScreen'
import { NestedWriterChecksScreen } from './screens/NestedWriterChecksScreen'
import { NotesScreen } from './screens/NotesScreen'
import { SetupErrorScreen } from './screens/SetupErrorScreen'

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  )
}

function AppContent() {
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
  // This is purely a UX choice: gating on readiness avoids a flash of "0 notes" while the
  // first-launch seed is still running, instead of relying on that queuing invisibly.
  const ready = useDatabaseReady(session.ok ? session.db.database : null)
  // Setting up the database failed (e.g. it's encrypted and this build has no passphrase for it):
  // readyPromise rejects, and the loading screen would otherwise stay forever
  const [setupError, setSetupError] = useState<string | null>(null)
  useEffect(() => {
    if (!session.ok) {
      return
    }
    session.db.database.readyPromise.catch((error: unknown) => {
      setSetupError(error instanceof Error ? error.message : String(error))
    })
  }, [session])
  const [showNestedWriterChecks, setShowNestedWriterChecks] = useState(false)

  if (!session.ok || setupError) {
    return (
      <KeyboardProvider>
        <SetupErrorScreen message={session.ok ? (setupError ?? '') : session.message} />
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

  if (showNestedWriterChecks) {
    return (
      <KeyboardProvider>
        <NestedWriterChecksScreen onClose={() => setShowNestedWriterChecks(false)} />
        <StatusBar style="auto" />
      </KeyboardProvider>
    )
  }

  return (
    <KeyboardProvider>
      <NotesScreen
        db={session.db}
        onOpenNestedWriterChecks={() => setShowNestedWriterChecks(true)}
      />
      <StatusBar style="auto" />
    </KeyboardProvider>
  )
}
