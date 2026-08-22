import { useCallback, useImperativeHandle, useRef, type Ref } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
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

const LIST_PADDING_TOP = 12
// One-line title + body + meta, plus card padding/border/marginBottom.
const NOTE_ROW_HEIGHT = 134

export function NotesList({ notes, onDelete, ref }: NotesListProps) {
  const listRef = useRef<FlatList<Note>>(null)

  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    },
  }))

  const getItemLayout = useCallback((_data: ArrayLike<Note> | null | undefined, index: number) => {
    return {
      length: NOTE_ROW_HEIGHT,
      offset: LIST_PADDING_TOP + NOTE_ROW_HEIGHT * index,
      index,
    }
  }, [])

  return (
    <View style={styles.wrap} testID="notes-list">
      <FlatList
        ref={listRef}
        style={styles.list}
        data={notes}
        keyExtractor={(note) => note.id}
        renderItem={({ item }) => <NoteCard note={item} onDelete={onDelete} />}
        getItemLayout={getItemLayout}
        ListEmptyComponent={
          <Text style={styles.empty} testID="empty-notes">
            No notes yet. Add one below.
          </Text>
        }
        contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.listContent}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator
        persistentScrollbar
        accessible={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: LIST_PADDING_TOP,
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
