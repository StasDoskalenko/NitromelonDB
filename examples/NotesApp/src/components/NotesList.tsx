import { StyleSheet, Text } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import type { Ref } from 'react'
import { NoteCard } from './NoteCard'
import type Note from '../model/Note'
import { colors } from '../theme'

type NotesListProps = {
  notes: Note[]
  listRef: Ref<FlashListRef<Note>>
  onDelete: (note: Note) => void
}

export function NotesList({ notes, listRef, onDelete }: NotesListProps) {
  return (
    <FlashList
      ref={listRef}
      style={styles.list}
      data={notes}
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
    paddingBottom: 12,
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
