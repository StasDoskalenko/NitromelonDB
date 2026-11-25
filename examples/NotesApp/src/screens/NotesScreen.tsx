import { useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { ComposerDock } from '../components/ComposerDock'
import { NotesComposer } from '../components/NotesComposer'
import { NotesHeader } from '../components/NotesHeader'
import { NotesList, type NotesListHandle } from '../components/NotesList'
import { NotesPager } from '../components/NotesPager'
import { PAGE_SIZE } from '../constants'
import { DEMO_PASSPHRASE, type ExampleDatabase } from '../database'
import { useNotes } from '../hooks/useNotes'
import { useScreenInsets } from '../hooks/useScreenInsets'
import Note from '../model/Note'
import { hasSyncedKey, syncNotes } from '../sync'
import { colors } from '../theme'

type NotesScreenProps = {
  db: ExampleDatabase
  onOpenNestedWriterChecks?: () => void
}

export function NotesScreen({ db, onOpenNestedWriterChecks }: NotesScreenProps) {
  const [page, setPage] = useState(1)
  const { notes, totalCount } = useNotes(db, page, PAGE_SIZE)
  const insets = useScreenInsets()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // NotesComposer's Windows title field is uncontrolled (defaultValue) because
  // driver-injected/IME input there doesn't reliably fire onChangeText; bumping
  // this after a successful add remounts it to actually clear the text.
  const [composerKey, setComposerKey] = useState(0)
  const listRef = useRef<NotesListHandle>(null)
  // A ref, not just the `busy` state: state only updates on the next render,
  // so a second submit landing in the same tick as the first — e.g. Enter and
  // a fallback button click on Windows — would still read `busy` as false.
  const addInFlight = useRef(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const syncInFlight = useRef(false)
  // Shown in the status ("Synced (2)") so Maestro can tell one finished sync from the next
  const syncCount = useRef(0)
  // Turbo Login is for an install's first sync, into an empty database (src/sync.ts)
  const [canTurboSync, setCanTurboSync] = useState(false)

  // Encryption build only: whether the database is encrypted, or what encrypting it is doing
  const [encryptionStatus, setEncryptionStatus] = useState<string | null>(null)
  const [canEncrypt, setCanEncrypt] = useState(false)
  const [canDecrypt, setCanDecrypt] = useState(false)

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  useEffect(() => {
    let stale = false
    db.database.localStorage.get(hasSyncedKey).then(
      (hasSynced) => {
        if (!stale) {
          setCanTurboSync(!hasSynced)
        }
      },
      () => {},
    )
    return () => {
      stale = true
    }
  }, [db])

  useEffect(() => {
    if (!db.encryptionAvailable) {
      return
    }
    let stale = false
    db.database.isDBEncrypted().then(
      (encrypted) => {
        if (!stale) {
          setEncryptionStatus(encrypted ? 'Encrypted' : 'Not encrypted')
          setCanEncrypt(!encrypted)
          setCanDecrypt(encrypted)
        }
      },
      (error: unknown) => {
        if (!stale) {
          setEncryptionStatus(`Encryption state unknown: ${String(error)}`)
        }
      },
    )
    return () => {
      stale = true
    }
  }, [db])

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount])

  useEffect(() => {
    listRef.current?.scrollToTop()
  }, [page])

  const goToPage = (delta: number) => {
    setPage((current) => Math.min(pageCount, Math.max(1, current + delta)))
  }

  const addNote = async (nativeTitle?: string) => {
    const nextTitle = nativeTitle?.trim() || title.trim()
    if (!nextTitle || addInFlight.current) {
      return
    }
    addInFlight.current = true
    const nextBody = body.trim()
    Keyboard.dismiss()
    setTitle('')
    setBody('')
    setActionError(null)
    setBusy(true)
    try {
      await Note.addNote(db.notes, nextTitle, nextBody)
      setPage(1)
      listRef.current?.scrollToTop()
      setComposerKey((current) => current + 1)
    } catch (writeError) {
      setActionError(writeError instanceof Error ? writeError.message : String(writeError))
    } finally {
      addInFlight.current = false
      setBusy(false)
    }
  }

  const sync = async (turbo = false) => {
    if (syncInFlight.current) {
      return
    }
    syncInFlight.current = true
    setCanTurboSync(false)
    setSyncStatus('Syncing…')
    try {
      await syncNotes(db.database, { turbo })
      syncCount.current += 1
      setSyncStatus(`Synced (${syncCount.current})`)
    } catch (syncError) {
      // Offer Turbo Login again unless the sync got as far as applying a pull (see hasSyncedKey)
      const hasSynced = await db.database.localStorage.get(hasSyncedKey).catch(() => true)
      setCanTurboSync(!hasSynced)
      setSyncStatus(
        `Sync failed: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
      )
    } finally {
      syncInFlight.current = false
    }
  }

  // An install from the plain build, opened with ifUnencrypted: 'open' (see database.ts)
  const encrypt = async () => {
    setCanEncrypt(false)
    setCanDecrypt(false)
    setEncryptionStatus('Encrypting…')
    try {
      await db.database.write(async () => {
        await db.database.unsafe_EncryptDB(DEMO_PASSPHRASE)
      })
      const encrypted = await db.database.isDBEncrypted()
      setEncryptionStatus(encrypted ? 'Encrypted' : 'Not encrypted')
      setCanDecrypt(encrypted)
    } catch (encryptError) {
      setCanEncrypt(true)
      setEncryptionStatus(
        `Encryption failed: ${encryptError instanceof Error ? encryptError.message : String(encryptError)}`,
      )
    }
  }

  // Back to a plain database (copy, sync, replace the file, reopen: see unsafe_DecryptDB)
  const decrypt = async () => {
    setCanEncrypt(false)
    setCanDecrypt(false)
    setEncryptionStatus('Decrypting…')
    try {
      await db.database.write(async () => {
        await db.database.unsafe_DecryptDB()
      })
      const encrypted = await db.database.isDBEncrypted()
      setEncryptionStatus(encrypted ? 'Encrypted' : 'Not encrypted')
      setCanEncrypt(!encrypted)
      setCanDecrypt(encrypted)
    } catch (decryptError) {
      setCanDecrypt(true)
      setEncryptionStatus(
        `Decryption failed: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`,
      )
    }
  }

  const deleteAllNotes = async () => {
    if (deletingAll) {
      return
    }
    setActionError(null)
    setDeletingAll(true)
    try {
      await Note.deleteAllForever(db.notes)
      setPage(1)
    } catch (writeError) {
      setActionError(writeError instanceof Error ? writeError.message : String(writeError))
    } finally {
      setDeletingAll(false)
    }
  }

  return (
    // Keyboard-avoidance is scoped to the composer (ComposerDock), not the
    // whole screen: an earlier root-level KeyboardAvoidingView ate Maestro's
    // swipe gestures on the list, and plain RN KeyboardAvoidingView doesn't
    // react at all under this Expo SDK's mandatory Android edge-to-edge.
    // Left/right insets are non-zero on iPhone Duo's inner display and in
    // landscape; the screen background still runs edge to edge.
    <View style={[styles.screen, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <NotesHeader
        sqliteEngine={db.sqliteEngine}
        schemaVersion={db.schemaVersion}
        totalCount={totalCount}
        onLongPressTitle={onOpenNestedWriterChecks}
        onSync={() => void sync()}
        onTurboSync={canTurboSync && totalCount === 0 ? () => void sync(true) : null}
        syncStatus={syncStatus}
        encryptionStatus={encryptionStatus}
        onEncrypt={canEncrypt ? () => void encrypt() : null}
        onDecrypt={canDecrypt ? () => void decrypt() : null}
      />

      <Pressable
        onPress={() => void deleteAllNotes()}
        disabled={deletingAll || totalCount === 0}
        hitSlop={12}
        style={[
          styles.deleteAllButton,
          (deletingAll || totalCount === 0) && styles.deleteAllButtonDisabled,
        ]}
        testID="delete-all-button"
        accessibilityRole="button"
        accessibilityLabel="Delete all notes"
      >
        <Text style={styles.deleteAllLabel} accessible={false}>
          {deletingAll ? 'Deleting all…' : 'Delete all'}
        </Text>
      </Pressable>

      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

      <NotesPager
        page={page}
        pageCount={pageCount}
        onPrev={() => goToPage(-1)}
        onNext={() => goToPage(1)}
      />

      <NotesList ref={listRef} notes={notes} onError={setActionError} />

      <ComposerDock>
        <NotesComposer
          key={composerKey}
          title={title}
          body={body}
          busy={busy}
          onChangeTitle={setTitle}
          onChangeBody={setBody}
          onSubmit={(nativeTitle) => void addNote(nativeTitle)}
        />
      </ComposerDock>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.background,
  },
  error: {
    marginHorizontal: 20,
    marginBottom: 8,
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  deleteAllButton: {
    alignSelf: 'flex-end',
    marginHorizontal: 20,
    marginBottom: 8,
    minHeight: 32,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteAllButtonDisabled: {
    opacity: 0.35,
  },
  deleteAllLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
  },
})
