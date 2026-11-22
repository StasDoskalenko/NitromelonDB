import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useScreenInsets } from '../hooks/useScreenInsets'
import { colors } from '../theme'

type NotesHeaderProps = {
  sqliteEngine: string
  schemaVersion: number
  totalCount: number
  // Hidden entry point to the nested-writer diagnostics screen (maestro/nested-writers.yaml)
  onLongPressTitle?: () => void
  // Syncs with examples/sync-server (src/sync.ts, maestro/sync.yaml)
  onSync?: () => void
  syncStatus?: string | null
  // Encryption build only (maestro-encryption/): "Encrypted", "Not encrypted", ...
  encryptionStatus?: string | null
  // Shown while the database isn't encrypted
  onEncrypt?: (() => void) | null
}

export function NotesHeader({
  sqliteEngine,
  schemaVersion,
  totalCount,
  onLongPressTitle,
  onSync,
  syncStatus,
  encryptionStatus,
  onEncrypt,
}: NotesHeaderProps) {
  const insets = useScreenInsets()

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 24) }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title} testID="app-title" accessible onLongPress={onLongPressTitle}>
          NitromelonDB
        </Text>
        {onSync ? (
          <Pressable onPress={onSync} testID="sync-button" accessibilityRole="button" hitSlop={8}>
            <Text style={styles.syncButton}>Sync</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.subtitle} testID="subtitle" accessible>
        {sqliteEngine} · schema v{schemaVersion} · {totalCount} note
        {totalCount === 1 ? '' : 's'}
      </Text>
      {syncStatus ? (
        <Text style={styles.subtitle} testID="sync-status" accessible>
          {syncStatus}
        </Text>
      ) : null}
      {encryptionStatus ? (
        <View style={styles.encryptionRow}>
          <Text style={styles.subtitle} testID="encryption-status" accessible>
            {encryptionStatus}
          </Text>
          {onEncrypt ? (
            <Pressable
              onPress={onEncrypt}
              testID="encrypt-button"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.encryptButton}>Encrypt</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  encryptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  encryptButton: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  syncButton: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
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
