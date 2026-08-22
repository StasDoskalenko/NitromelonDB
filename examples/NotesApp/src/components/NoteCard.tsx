import { Pressable, StyleSheet, Text, View } from 'react-native'
import type Note from '../model/Note'
import { colors } from '../theme'
import { formatTime } from '../utils/formatTime'

type NoteCardProps = {
  note: Note
  onDelete: (note: Note) => void
}

export function NoteCard({ note, onDelete }: NoteCardProps) {
  return (
    <View style={[styles.card, note.pinned && styles.cardPinned]} testID={`note-card-${note.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} testID={note.title} accessible>
          {note.title}
        </Text>
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => void note.togglePinned()}
            hitSlop={12}
            style={styles.actionHit}
            testID={`pin-button-${note.title}`}
            accessibilityRole="button"
            accessibilityLabel={note.pinned ? 'Unpin' : 'Pin'}
          >
            <Text style={styles.action} accessible={false}>
              {note.pinned ? 'Unpin' : 'Pin'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onDelete(note)}
            hitSlop={12}
            style={styles.actionHit}
            testID={`delete-button-${note.title}`}
            accessibilityRole="button"
            accessibilityLabel="Delete"
          >
            <Text style={[styles.action, styles.delete]} accessible={false}>
              Delete
            </Text>
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
