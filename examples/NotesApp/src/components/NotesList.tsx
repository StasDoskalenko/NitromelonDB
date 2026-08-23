import { useImperativeHandle, useRef, type Ref } from 'react'
import { StyleSheet, Text } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { NoteCard } from './NoteCard'
import type Note from '../model/Note'
import { colors } from '../theme'
import type { NotesListHandle } from './NotesListHandle'

export type { NotesListHandle } from './NotesListHandle'

type NotesListProps = {
  notes: Note[]
  onDelete: (note: Note) => void
  ref?: Ref<NotesListHandle>
}

export function NotesList({ notes, onDelete, ref }: NotesListProps) {
  const listRef = useRef<FlashListRef<Note>>(null)

  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      listRef.current?.scrollToTop({ animated: false })
    },
  }))

  return (
    <FlashList<Note>
      ref={listRef}
      style={styles.list}
      data={notes}
      // FlashList v2 keeps existing content anchored in view by default when
      // rows are added above it — the opposite of what we want here, since a
      // new note always sorts to the top. autoscrollToTopThreshold opts back
      // into scrolling to reveal it.
      maintainVisibleContentPosition={{ autoscrollToTopThreshold: 10000 }}
      keyExtractor={(note) => note.id}
      contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.listContent}
      testID="notes-list"
      ListEmptyComponent={
        <Text style={styles.empty} testID="empty-notes">
          No notes yet. Add one below.
        </Text>
      }
      renderItem={({ item }) => <NoteCard note={item} onDelete={onDelete} />}
    />
  )
}

const styles = StyleSheet.create({
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
