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
  const [listRevision, setListRevision] = useState(0)
  const { notes, totalCount, error: loadError } = useNotes(db, page, PAGE_SIZE, listRevision)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const listRef = useRef<NotesListHandle>(null)
  // Maestro/WinAppDriver list-row presses can land twice; ignore a rapid second delete.
  const lastDeleteAt = useRef(0)
  const lastAddAt = useRef(0)
  const writeChain = useRef(Promise.resolve())
  const pendingAdds = useRef(0)
  const sortOrderRef = useRef(Date.now())

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

  const addNote = (nativeTitle?: string) => {
    const nextTitle = nativeTitle?.trim() || title.trim()
    const nextBody = body.trim()
    if (!nextTitle) {
      return
    }
    const now = Date.now()
    if (now - lastAddAt.current < 400) {
      return
    }
    lastAddAt.current = now
    Keyboard.dismiss()
    setTitle('')
    setBody('')
    setActionError(null)
    pendingAdds.current += 1
    setBusy(true)
    const sortOrder = Math.max(Date.now(), sortOrderRef.current + 1)
    sortOrderRef.current = sortOrder
    writeChain.current = writeChain.current
      .then(() =>
        db.database.write(async () => {
          await db.notes.create((note) => {
            note.title = nextTitle
            note.body = nextBody
            note.createdAt = new Date()
            note.sortOrder = sortOrder
            note.pinned = false
          })
        }),
      )
      .then(() => {
        setPage(1)
        setListRevision((current) => current + 1)
        // Android: a query re-run with the same skip/take/sort as one already
        // served can come back stale immediately after an insert (observed:
        // pin/delete refresh live via the column-diff path and always see the
        // write; a same-page reload after create does not, even after 90s+).
        // Bouncing the page forces a query with different parameters, which
        // reliably picks up the new row; bumping listRevision alone (same
        // params) does not. Deferred to its own tick (setTimeout, not
        // requestAnimationFrame — RNW doesn't reliably run the rAF/render
        // loop for a window that isn't actively compositing, e.g. backgrounded
        // or off-screen in CI, which silently dropped this step there) so it
        // can't land in the same commit as the listRevision-driven composer
        // remount above — doing both together left the composer's title
        // uncleared.
        setTimeout(() => {
          setPage((current) => current + 1)
          setTimeout(() => setPage(1), 0)
        }, 0)
      })
      .catch((writeError) => {
        setActionError(writeError instanceof Error ? writeError.message : String(writeError))
      })
      .finally(() => {
        pendingAdds.current -= 1
        if (pendingAdds.current === 0) {
          setBusy(false)
        }
      })
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
        key={listRevision}
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
