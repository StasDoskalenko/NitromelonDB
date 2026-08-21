import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from 'react-native'
import type { FlashListRef } from '@shopify/flash-list'
import { NotesComposer } from '../components/NotesComposer'
import { NotesHeader } from '../components/NotesHeader'
import { NotesList } from '../components/NotesList'
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
  const listRef = useRef<FlashListRef<Note>>(null)
  // Maestro doubleTapOn is required for list-row presses; ignore a rapid second delete
  // (the second tap often lands on the next row after the list reorders).
  const lastDeleteAt = useRef(0)

  const error = actionError ?? loadError
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const firstNoteId = notes[0]?.id

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount])

  // Keep the window top-aligned when the page changes or new rows appear at the top.
  useEffect(() => {
    listRef.current?.scrollToTop({ animated: false })
  }, [page, firstNoteId])

  const goToPage = (nextPage: number) => {
    setPage(Math.min(pageCount, Math.max(1, nextPage)))
  }

  const addNote = async () => {
    const nextTitle = title.trim()
    if (!nextTitle || busy) {
      return
    }
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

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NotesHeader
        sqliteEngine={db.sqliteEngine}
        schemaVersion={db.schemaVersion}
        totalCount={totalCount}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <NotesPager
        page={page}
        pageCount={pageCount}
        onPrev={() => goToPage(page - 1)}
        onNext={() => goToPage(page + 1)}
      />

      <NotesList notes={notes} listRef={listRef} onDelete={deleteNote} />

      <NotesComposer
        title={title}
        body={body}
        busy={busy}
        onChangeTitle={setTitle}
        onChangeBody={setBody}
        onSubmit={() => void addNote()}
      />
      <StatusBar style="auto" />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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
