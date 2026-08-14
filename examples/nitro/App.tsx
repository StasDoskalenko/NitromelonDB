import { StatusBar } from 'expo-status-bar'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { nitromelon } from '@nozbe/watermelondb/src/nitro'

export default function App() {
  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        engine: nitromelon.nativeEngine,
        ping: nitromelon.ping(),
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }, [])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>NitromelonDB Nitro</Text>
      {result.ok ? (
        <>
          <Text style={styles.line}>nativeEngine: {result.engine}</Text>
          <Text style={styles.line}>ping(): {result.ping}</Text>
        </>
      ) : (
        <Text style={styles.error}>{result.message}</Text>
      )}
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 16,
  },
  line: {
    fontSize: 16,
    marginBottom: 8,
  },
  error: {
    fontSize: 14,
    color: '#b00020',
    textAlign: 'center',
  },
})
