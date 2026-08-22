import { useEffect, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { NotesComposer } from '../components/NotesComposer'
import { NotesHeader } from '../components/NotesHeader'
import { NotesList, type NotesListHandle } from '../components/NotesList'
import { NotesPager } from '../components/NotesPager'
import { PAGE_SIZE } from '../constants'
import type { ExampleDatabase } from '../database'
import { useNotes } from '../hooks/useNotes'
import type Note from '../model/Note'
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
  const listRef = useRef<NotesListHandle>(null)
  // Maestro/WinAppDriver list-row presses can land twice; ignore a rapid second delete.
  const lastDeleteAt = useRef(0)

  const error = actionError ?? loadError
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const firstNoteId = notes[0]?.id

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount])

  useEffect(() => {
    listRef.current?.scrollToTop()
  }, [page, firstNoteId])

  const goToPage = (delta: number) => {
    setPage((current) => Math.min(pageCount, Math.max(1, current + delta)))
  }

  const addNote = async (nativeTitle?: string) => {
    const nextTitle = nativeTitle?.trim() || title.trim()
    if (!nextTitle || busy) {
      return
    }
    Keyboard.dismiss()
    setBusy(true)
    setActionError(null)
    try {
      await db.database.write(async () => {
        await db.notes.create((note) => {
          note.title = nextTitle
          note.body = body.trim()
          note.createdAt = new Date()
          note.sortOrder = Date.now()
          note.pinned = false
        })
      })
      setTitle('')
      setBody('')
      setPage(1)
    } catch (writeError) {
      setActionError(writeError instanceof Error ? writeError.message : String(writeError))
    } finally {
      setBusy(false)
    }
  }

  const deleteNote = (note: Note) => {
    const now = Date.now()
    if (now - lastDeleteAt.current < 600) {
      return
    }
    lastDeleteAt.current = now
    void note.deleteForever()
  }

  const rootProps = Platform.OS === 'ios' ? { behavior: 'padding' as const } : {}
  // Android uses windowSoftInputMode=adjustResize (app.json). KeyboardAvoidingView
  // without behavior is a no-op and can eat Maestro swipes on the list.
  const ScreenRoot = Platform.OS === 'ios' ? KeyboardAvoidingView : View

  return (
    <ScreenRoot style={styles.screen} {...rootProps}>
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

      <NotesList ref={listRef} notes={notes} onDelete={deleteNote} />

      <NotesComposer
        title={title}
        body={body}
        busy={busy}
        onChangeTitle={setTitle}
        onChangeBody={setBody}
        onSubmit={(nativeTitle) => void addNote(nativeTitle)}
      />
    </ScreenRoot>
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
