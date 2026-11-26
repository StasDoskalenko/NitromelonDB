import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import invariant from '../utils/common/invariant'

import type Database from '../Database'
import type { EncryptionEvents, EncryptionOperation } from '../adapters/sqlite/type'
import { DatabaseContext } from '../DatabaseProvider'

export type UseEncryptionState =
  // Not known yet (the database is still opening)
  | 'loading'
  | 'encrypted'
  | 'unencrypted'
  // This adapter can't encrypt: a SQLiteAdapter without the `encryption` option, or LokiJS
  | 'unavailable'

export type UseEncryptionResult = {
  state: UseEncryptionState
  /** What's running right now, from this hook or anywhere else (`null`: nothing). */
  operation: EncryptionOperation | null
  /**
   * 0 to 1 while `operation` runs (`null` otherwise). On Node and Electron it stays at 0 until the
   * operation is done (see `encryption.events.onProgress`).
   */
  progress: number | null
  /** The last error: from encrypting or decrypting, or from checking the state. */
  error: Error | null
  /**
   * Encrypts the database with `passphrase`, or changes its passphrase if it's encrypted: runs
   * `database.unsafe_EncryptDB(passphrase)` in a writer. Save the passphrase first (e.g. in the
   * Keychain). Rejects if it fails, and sets `error`.
   */
  encrypt: (passphrase: string) => Promise<void>
  /** Decrypts the database: runs `database.unsafe_DecryptDB()` in a writer. */
  decrypt: () => Promise<void>
}

type EncryptionAdapter = {
  encryptionEnabled: boolean
  subscribeToEncryptionEvents: (events: EncryptionEvents) => () => void
}

function encryptionAdapter(database: Database | null | undefined): EncryptionAdapter | null {
  const adapter = database?.adapter?.underlyingAdapter as Partial<EncryptionAdapter> | undefined
  return adapter &&
    typeof adapter.subscribeToEncryptionEvents === 'function' &&
    adapter.encryptionEnabled
    ? (adapter as EncryptionAdapter)
    : null
}

/**
 * Whether the database is encrypted, and what encrypting or decrypting it is doing, for a settings
 * screen or a progress bar. Uses the database from `<DatabaseProvider>`, or the one you pass.
 *
 * ```js
 * function EncryptionSettings() {
 *   const { state, operation, progress, error, encrypt } = useEncryption()
 *   if (operation) {
 *     return <ProgressBar value={progress} />
 *   }
 *   return (
 *     <>
 *       {error ? <Text>{error.message}</Text> : null}
 *       <Button
 *         title="Encrypt"
 *         disabled={state !== 'unencrypted'}
 *         onPress={async () => encrypt(await savedPassphrase())}
 *       />
 *     </>
 *   )
 * }
 * ```
 *
 * It follows every `database.unsafe_EncryptDB()` and `unsafe_DecryptDB()`, not only the ones it
 * starts. The database must use SQLiteAdapter with the `encryption` option (with
 * `ifUnencrypted: 'open'` to encrypt a database that isn't encrypted yet); otherwise `state` is
 * `'unavailable'`. See docs/Encryption.
 */
export default function useEncryption(database?: Database | null): UseEncryptionResult {
  const contextDatabase = useContext(DatabaseContext)
  const db = database ?? contextDatabase
  invariant(db, 'useEncryption: pass a database, or wrap the component in <DatabaseProvider>')

  const [state, setState] = useState<UseEncryptionState>(() =>
    encryptionAdapter(db) ? 'loading' : 'unavailable',
  )
  const [operation, setOperation] = useState<EncryptionOperation | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const isMountedRef = useRef(true)
  useEffect(
    () => () => {
      isMountedRef.current = false
    },
    [],
  )

  useEffect(() => {
    const adapter = encryptionAdapter(db)
    if (!adapter) {
      setState('unavailable')
      return undefined
    }
    setState('loading')
    let stale = false
    const unsubscribe = adapter.subscribeToEncryptionEvents({
      onStart: (info) => {
        setOperation(info.operation)
        setProgress(0)
        setError(null)
      },
      onProgress: (info) => setProgress(info.progress),
      onSuccess: (info) => {
        setOperation(null)
        setProgress(null)
        setState(info.operation === 'decrypt' ? 'unencrypted' : 'encrypted')
      },
      onError: (operationError) => {
        setOperation(null)
        setProgress(null)
        setError(operationError)
      },
    })
    // Queued behind anything already called, so it can't overtake an operation in progress
    db.isDBEncrypted().then(
      (encrypted) => {
        if (!stale) {
          setState(encrypted ? 'encrypted' : 'unencrypted')
        }
      },
      (checkError: Error) => {
        if (!stale) {
          setError(checkError)
        }
      },
    )
    return () => {
      stale = true
      unsubscribe()
    }
  }, [db])

  const run = useCallback(
    async (name: string, action: () => Promise<void>): Promise<void> => {
      isMountedRef.current && setError(null)
      try {
        await db.write(action, name)
      } catch (thrownError) {
        isMountedRef.current && setError(thrownError as Error)
        throw thrownError
      }
    },
    [db],
  )

  const encrypt = useCallback(
    (passphrase: string) => run('useEncryption.encrypt', () => db.unsafe_EncryptDB(passphrase)),
    [db, run],
  )
  const decrypt = useCallback(
    () => run('useEncryption.decrypt', () => db.unsafe_DecryptDB()),
    [db, run],
  )

  return { state, operation, progress, error, encrypt, decrypt }
}
