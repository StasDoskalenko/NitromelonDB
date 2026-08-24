import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

type NotesPagerProps = {
  page: number
  pageCount: number
  onPrev: () => void
  onNext: () => void
}

export function NotesPager({ page, pageCount, onPrev, onNext }: NotesPagerProps) {
  const canGoPrev = page > 1
  const canGoNext = page < pageCount

  return (
    <View style={styles.pager} testID="pager">
      <Pressable
        style={[styles.pagerButton, !canGoPrev && styles.pagerButtonDisabled]}
        onPress={onPrev}
        disabled={!canGoPrev}
        testID="prev-page-button"
        accessibilityRole="button"
        accessibilityLabel="Previous page"
      >
        <Text style={styles.pagerButtonLabel} accessible={false}>
          Previous
        </Text>
      </Pressable>
      <Text style={styles.pagerLabel} testID="page-label" accessible>
        Page {page} of {pageCount}
      </Text>
      <Pressable
        style={[styles.pagerButton, !canGoNext && styles.pagerButtonDisabled]}
        onPress={onNext}
        disabled={!canGoNext}
        testID="next-page-button"
        accessibilityRole="button"
        accessibilityLabel="Next page"
      >
        <Text style={styles.pagerButtonLabel} accessible={false}>
          Next
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  pagerButton: {
    minWidth: 88,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerButtonDisabled: {
    opacity: 0.35,
    backgroundColor: colors.disabled,
  },
  pagerButtonLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  pagerLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
  },
})
