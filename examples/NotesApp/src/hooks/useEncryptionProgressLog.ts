import { useEffect, useState } from 'react'
import type { Database } from 'nitromelondb'
import type { EncryptionEvents, EncryptionOperation } from 'nitromelondb/adapters/sqlite'

type EncryptionAdapter = {
  encryptionEnabled?: boolean
  subscribeToEncryptionEvents?: (events: EncryptionEvents) => () => void
}

// What encryption.events.onProgress reported during the last encrypt or decrypt, for
// maestro-encryption/12-progress.yaml (and e2e-encryption on Windows): "decrypt: 6 progress
// updates, only forward, 2140 ms". null until one finished, and in the plain build.
export function useEncryptionProgressLog(database: Database): string | null {
  const [log, setLog] = useState<string | null>(null)

  useEffect(() => {
    const adapter = database.adapter.underlyingAdapter as EncryptionAdapter
    if (typeof adapter.subscribeToEncryptionEvents !== 'function' || !adapter.encryptionEnabled) {
      return undefined
    }
    let values: number[] = []
    return adapter.subscribeToEncryptionEvents({
      onStart: () => {
        values = []
      },
      onProgress: ({ progress }) => {
        values.push(progress)
      },
      onSuccess: ({ operation, durationMs }) => {
        setLog(describe(operation, values, durationMs))
      },
    })
  }, [database])

  return log
}

function describe(operation: EncryptionOperation, values: number[], durationMs: number): string {
  const duration = `${Math.round(durationMs)} ms`
  if (!values.length) {
    return `${operation}: no progress updates, ${duration}`
  }
  const inRange = values.every((value) => value >= 0 && value <= 1)
  const forward = values.every((value, i) => i === 0 || value >= values[i - 1])
  const shape = !inRange ? 'out of range' : forward ? 'only forward' : 'went back'
  const updates = `${values.length} progress update${values.length === 1 ? '' : 's'}`
  return `${operation}: ${updates}, ${shape}, ${duration}`
}
