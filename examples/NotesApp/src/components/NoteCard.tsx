import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useWriter } from 'nitromelondb/hooks'
import type Note from '../model/Note'
import { colors } from '../theme'
import { formatTime } from '../utils/formatTime'
import { noteDeleteTestID, notePinTestID } from '../utils/noteTestIds'

type NoteCardProps = {
  note: Note
  onError?: (message: string) => void
}

export function NoteCard({ note, onError }: NoteCardProps) {
  const [togglePinned] = useWriter(note, (target) => target.togglePinned())
  const [deleteForever, { isPending: isDeleting }] = useWriter(note, (target) =>
    target.deleteForever(),
  )

  const reportError = (error: unknown) => {
    onError?.(error instanceof Error ? error.message : String(error))
  }

  return (
    <View style={[styles.card, note.pinned && styles.cardPinned]} testID={`note-card-${note.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} testID={note.title} accessible>
          {note.title}
        </Text>
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => void togglePinned().catch(reportError)}
            hitSlop={12}
            style={styles.actionHit}
            testID={notePinTestID(note.title)}
            nativeID={notePinTestID(note.title)}
            accessibilityRole="button"
            accessibilityLabel={note.pinned ? 'Unpin' : 'Pin'}
          >
            <Text style={styles.action} accessible={false}>
              {note.pinned ? 'Unpin' : 'Pin'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void deleteForever().catch(reportError)}
            disabled={isDeleting}
            hitSlop={12}
            style={styles.actionHit}
            testID={noteDeleteTestID(note.title)}
            nativeID={noteDeleteTestID(note.title)}
            accessibilityRole="button"
            accessibilityLabel="Delete"
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Text style={[styles.action, styles.delete]} accessible={false}>
                Delete
              </Text>
            )}
          </Pressable>
        </View>
      </View>
      {note.body ? <Text style={styles.cardBody}>{note.body}</Text> : null}
      <Text style={styles.cardMeta}>{formatTime(note.createdAt)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPinned: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
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
    color: colors.text,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionHit: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  action: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  delete: {
    color: colors.danger,
  },
  cardBody: {
    marginTop: 6,
    fontSize: 15,
    color: colors.textBody,
    lineHeight: 20,
  },
  cardMeta: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textMeta,
  },
})
