import { Platform, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

type NotesHeaderProps = {
  sqliteEngine: string
  schemaVersion: number
  totalCount: number
}

export function NotesHeader({ sqliteEngine, schemaVersion, totalCount }: NotesHeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.title} testID="app-title" accessible>
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
    paddingTop: Platform.OS === 'windows' ? 24 : 64,
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
