import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { createExampleDatabase } from './database'
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

  if (!session.ok) {
    return (
      <>
        <SetupErrorScreen message={session.message} />
        <StatusBar style="auto" />
      </>
    )
  }

  return (
    <>
      <NotesScreen db={session.db} />
      <StatusBar style="auto" />
    </>
  )
}
