import { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, Text, View } from 'react-native'
import { ComposerDock } from '../components/ComposerDock'
import { NotesComposer } from '../components/NotesComposer'
import { NotesHeader } from '../components/NotesHeader'
import { NotesList, type NotesListHandle } from '../components/NotesList'
import { NotesPager } from '../components/NotesPager'
import { PAGE_SIZE } from '../constants'
import type { ExampleDatabase } from '../database'
import { useNotes } from '../hooks/useNotes'
import Note from '../model/Note'
import { colors } from '../theme'

type NotesScreenProps = {
  db: ExampleDatabase
}

export function NotesScreen({ db }: NotesScreenProps) {
  const [page, setPage] = useState(1)
  const { notes, totalCount, error: loadError } = useNotes(db, page, PAGE_SIZE)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set())
  // NotesComposer's Windows title field is uncontrolled (defaultValue) because
  // driver-injected/IME input there doesn't reliably fire onChangeText; bumping
  // this after a successful add remounts it to actually clear the text.
  const [composerKey, setComposerKey] = useState(0)
  const listRef = useRef<NotesListHandle>(null)
  // A ref, not just the `busy` state: state only updates on the next render,
  // so a second submit landing in the same tick as the first — e.g. Enter and
  // a fallback button click on Windows — would still read `busy` as false.
  const addInFlight = useRef(false)

  const error = actionError ?? loadError
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

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

  const deleteNote = async (note: Note) => {
    if (deletingIds.has(note.id)) {
      return
    }
    setDeletingIds((current) => new Set(current).add(note.id))
    try {
      await note.deleteForever()
    } catch (writeError) {
      setActionError(writeError instanceof Error ? writeError.message : String(writeError))
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current)
        next.delete(note.id)
        return next
      })
    }
  }

  return (
    // Keyboard-avoidance is scoped to the composer (ComposerDock), not the
    // whole screen: an earlier root-level KeyboardAvoidingView ate Maestro's
    // swipe gestures on the list, and plain RN KeyboardAvoidingView doesn't
    // react at all under this Expo SDK's mandatory Android edge-to-edge.
    <View style={styles.screen}>
      <NotesHeader
        sqliteEngine={db.sqliteEngine}
        schemaVersion={db.schemaVersion}
        totalCount={totalCount}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <NotesPager
        page={page}
        pageCount={pageCount}
        onPrev={() => goToPage(-1)}
        onNext={() => goToPage(1)}
      />

      <NotesList
        ref={listRef}
        notes={notes}
        deletingIds={deletingIds}
        onDelete={(note) => void deleteNote(note)}
      />

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
})
