import { StyleSheet, Text, View } from 'react-native'
import { useScreenInsets } from '../hooks/useScreenInsets'
import { colors } from '../theme'

type NotesHeaderProps = {
  sqliteEngine: string
  schemaVersion: number
  totalCount: number
  // Hidden entry point to the nested-writer diagnostics screen (maestro/nested-writers.yaml)
  onLongPressTitle?: () => void
}

export function NotesHeader({
  sqliteEngine,
  schemaVersion,
  totalCount,
  onLongPressTitle,
}: NotesHeaderProps) {
  const insets = useScreenInsets()

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 24) }]}>
      <Text style={styles.title} testID="app-title" accessible onLongPress={onLongPressTitle}>
        NitromelonDB
      </Text>
      <Text style={styles.subtitle} testID="subtitle" accessible>
        {sqliteEngine} · schema v{schemaVersion} · {totalCount} note
        {totalCount === 1 ? '' : 's'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary,
  },
})
