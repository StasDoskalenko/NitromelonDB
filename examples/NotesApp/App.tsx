import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Q } from 'nitromelondb'
import { createExampleDatabase, type ExampleDatabase } from './database'
import Note from './model/Note'

const SEEDED_KEY = 'example.seeded'

function useNotes(session: ExampleDatabase, page: number, pageSize: number): { notes: Note[]; totalCount: number; error: string | null } {
  const [notes, setNotes] = useState<Note[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const unsubscribeCount = session.notes.query().experimentalSubscribeToCount((count) => {
      if (!cancelled) {
        setTotalCount(count)
      }
    })

    const seed = async () => {
      try {
        const seeded = await session.database.localStorage.get<boolean>(SEEDED_KEY)
        if (seeded) {
          return
        }
        await session.database.write(async () => {
          for (let i = 0; i < 100; i++) {
            await session.notes.create((note) => {
              note.title = `Note #${i + 1}`
              note.body = `This is note number ${i + 1}.`
              note.createdAt = new Date(Date.now() - (100 - i) * 60_000)
              note.sortOrder = i + 1
              note.pinned = false
            })
          }
        })
        await session.database.localStorage.set(SEEDED_KEY, true)
      } catch (seedError) {
        if (!cancelled) {
          setError(seedError instanceof Error ? seedError.message : String(seedError))
        }
      }
    }

    void seed()
    return () => {
      cancelled = true
      unsubscribeCount()
    }
  }, [session])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = session.notes
      .query(
        Q.sortBy('pinned', Q.desc),
        Q.sortBy('sort_order', Q.desc),
        Q.take(page * pageSize),
      )
      .experimentalSubscribeWithColumns(['title', 'body', 'pinned', 'sort_order'], (next) => {
        if (!cancelled) {
          setNotes(next)
        }
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [session, page, pageSize])

  return { notes, totalCount, error }
}

function formatTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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
      <View style={styles.centered}>
        <Text style={styles.title}>NitromelonDB</Text>
        <Text style={styles.error}>{session.message}</Text>
        <Text style={styles.hint}>Rebuild the native app after Nitro SQLite changes (`npx expo run:ios`).</Text>
        <StatusBar style="auto" />
      </View>
    )
  }

  return <NotesScreen db={session.db} />
}

function NotesScreen({ db }: { db: ExampleDatabase }) {
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const { notes, totalCount, error: loadError } = useNotes(db, page, PAGE_SIZE)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const error = actionError ?? loadError

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

  const hasMore = notes.length < totalCount

  const loadMore = () => {
    if (!hasMore) {
      return
    }
    setPage((current) => current + 1)
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.title}>NitromelonDB</Text>
        <Text style={styles.subtitle} testID="subtitle">
          {db.sqliteEngine} · schema v{db.schemaVersion} · {totalCount} note
          {totalCount === 1 ? '' : 's'}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        style={styles.list}
        data={notes}
        keyExtractor={(note) => note.id}
        contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.listContent}
        testID="notes-list"
        ListEmptyComponent={<Text style={styles.empty} testID="empty-notes">No notes yet. Add one below.</Text>}
        ListFooterComponent={() => (
          <Pressable
            style={[styles.loadMoreButton, !hasMore && styles.loadMoreButtonDisabled]}
            onPress={loadMore}
            disabled={!hasMore}
            testID="load-more-button"
          >
            <Text style={styles.loadMoreButtonLabel}>Load more</Text>
          </Pressable>
        )}
        renderItem={({ item }) => (
          <View style={[styles.card, item.pinned && styles.cardPinned]} testID={`note-card-${item.id}`}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <View style={styles.cardActions}>
                <Pressable onPress={() => void item.togglePinned()} hitSlop={8} testID={`pin-button-${item.id}`}>
                  <Text style={styles.action}>{item.pinned ? 'Unpin' : 'Pin'}</Text>
                </Pressable>
                <Pressable onPress={() => void item.deleteForever()} hitSlop={8} testID={`delete-button-${item.id}`}>
                  <Text style={[styles.action, styles.delete]}>Delete</Text>
                </Pressable>
              </View>
            </View>
            {item.body ? <Text style={styles.cardBody}>{item.body}</Text> : null}
            <Text style={styles.cardMeta}>{formatTime(item.createdAt)}</Text>
          </View>
        )}
      />

      <View style={styles.composer} testID="composer">
        <TextInput
          style={styles.input}
          placeholder="Note title"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={() => void addNote()}
          returnKeyType="done"
          testID="title-input"
        />
        <TextInput
          style={[styles.input, styles.bodyInput]}
          placeholder="Optional details"
          value={body}
          onChangeText={setBody}
          multiline
          testID="body-input"
        />
        <Pressable
          style={[styles.addButton, (!title.trim() || busy) && styles.addButtonDisabled]}
          onPress={() => void addNote()}
          disabled={!title.trim() || busy}
          testID="add-note-button"
        >
          <Text style={styles.addButtonLabel}>{busy ? 'Saving…' : 'Add note'}</Text>
        </Pressable>
      </View>
      <StatusBar style="auto" />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f1ea',
  },
  centered: {
    flex: 1,
    backgroundColor: '#f4f1ea',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1c1917',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#57534e',
  },
  hint: {
    marginTop: 12,
    fontSize: 14,
    color: '#57534e',
    textAlign: 'center',
  },
  error: {
    marginHorizontal: 20,
    marginBottom: 8,
    color: '#b91c1c',
    fontSize: 14,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  empty: {
    textAlign: 'center',
    color: '#78716c',
    fontSize: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e7e5e4',
  },
  cardPinned: {
    borderColor: '#ea580c',
    backgroundColor: '#fff7ed',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#1c1917',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  action: {
    fontSize: 14,
    fontWeight: '600',
    color: '#c2410c',
  },
  delete: {
    color: '#b91c1c',
  },
  cardBody: {
    marginTop: 6,
    fontSize: 15,
    color: '#44403c',
    lineHeight: 20,
  },
  cardMeta: {
    marginTop: 8,
    fontSize: 12,
    color: '#a8a29e',
  },
  composer: {
    padding: 16,
    paddingBottom: 28,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e7e5e4',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d6d3d1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafaf9',
  },
  bodyInput: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  addButton: {
    backgroundColor: '#c2410c',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.45,
  },
  addButtonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadMoreButton: {
    backgroundColor: '#c2410c',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  loadMoreButtonDisabled: {
    opacity: 0.45,
  },
  loadMoreButtonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
