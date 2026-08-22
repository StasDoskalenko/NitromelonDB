import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors } from '../theme'

type NotesComposerProps = {
  title: string
  body: string
  busy: boolean
  onChangeTitle: (value: string) => void
  onChangeBody: (value: string) => void
  onSubmit: (nativeTitle?: string) => void
}

export function NotesComposer({
  title,
  body,
  busy,
  onChangeTitle,
  onChangeBody,
  onSubmit,
}: NotesComposerProps) {
  const canSubmit = Boolean(title.trim()) && !busy
  const isWindows = Platform.OS === 'windows'

  return (
    <View style={styles.composer} testID={isWindows ? undefined : 'composer'}>
      {isWindows ? (
        <Text testID="composer" accessible style={styles.composerAnchor}>
          composer
        </Text>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Note title"
        value={title}
        onChangeText={onChangeTitle}
        onEndEditing={(event) => onChangeTitle(event.nativeEvent.text)}
        onSubmitEditing={(event) => onSubmit(event.nativeEvent.text)}
        returnKeyType="done"
        testID="title-input"
      />
      <TextInput
        style={[styles.input, styles.bodyInput]}
        placeholder="Optional details"
        value={body}
        onChangeText={onChangeBody}
        multiline
        testID="body-input"
      />
      <Pressable
        style={[styles.addButton, !canSubmit && styles.addButtonDisabled]}
        onPress={() => onSubmit()}
        disabled={!canSubmit}
        testID="add-note-button"
        accessibilityRole="button"
        accessibilityLabel="Add note"
      >
        <Text style={styles.addButtonLabel}>{busy ? 'Saving…' : 'Add note'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  composer: {
    padding: 16,
    paddingBottom: 28,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  composerAnchor: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.surfaceMuted,
  },
  bodyInput: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.45,
  },
  addButtonLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
})
