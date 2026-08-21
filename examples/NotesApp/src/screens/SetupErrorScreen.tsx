import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

type SetupErrorScreenProps = {
  message: string
}

export function SetupErrorScreen({ message }: SetupErrorScreenProps) {
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>NitromelonDB</Text>
      <Text style={styles.error}>{message}</Text>
      <Text style={styles.hint}>
        Rebuild the native app after Nitro SQLite changes (`npx expo run:ios`).
      </Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  error: {
    marginTop: 12,
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  hint: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
})
