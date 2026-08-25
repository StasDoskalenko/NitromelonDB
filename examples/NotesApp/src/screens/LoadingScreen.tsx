import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

export function LoadingScreen() {
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>NitromelonDB</Text>
      <ActivityIndicator style={styles.spinner} color={colors.accent} />
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
  spinner: {
    marginTop: 16,
  },
})
