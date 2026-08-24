import { useImperativeHandle, useRef, type Ref } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { NoteCard } from './NoteCard'
import type Note from '../model/Note'
import { colors } from '../theme'
import type { NotesListHandle } from './NotesListHandle'

export type { NotesListHandle } from './NotesListHandle'

type NotesListProps = {
  notes: Note[]
  deletingIds: ReadonlySet<string>
  onDelete: (note: Note) => void
  ref?: Ref<NotesListHandle>
}

export function NotesList({ notes, deletingIds, onDelete, ref }: NotesListProps) {
  const listRef = useRef<ScrollView>(null)

  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      listRef.current?.scrollTo({ y: 0, animated: false })
    },
  }))

  return (
    <View style={styles.wrap}>
      <View style={styles.uiaAnchors} collapsable={false}>
        <Text testID="notes-list" accessible>
          {notes.map((note) => note.title).join('\n') || 'notes-list'}
        </Text>
      </View>
      <ScrollView
        key={notes[0]?.id ?? 'empty'}
        ref={listRef}
        style={styles.list}
        contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.listContent}
        accessible={false}
        showsVerticalScrollIndicator
        persistentScrollbar
      >
        {notes.length === 0 ? (
          <Text style={styles.empty} testID="empty-notes">
            No notes yet. Add one below.
          </Text>
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isDeleting={deletingIds.has(note.id)}
              onDelete={onDelete}
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 0,
  },
  uiaAnchors: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    overflow: 'hidden',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 16,
  },
})
