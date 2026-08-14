import { StatusBar } from 'expo-status-bar'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { nitromelon } from '@nozbe/watermelondb/src/nitro'

export default function App() {
  const result = useMemo(() => {
    try {
      const db = nitromelon.createAdapter('nitromelon-smoke', false)
      const status = db.initialize('nitromelon-smoke', 1)
      return {
        ok: true as const,
        code: status.code,
        databaseVersion: status.databaseVersion,
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
          <Text style={styles.line}>initialize(): {result.code}</Text>
          {result.databaseVersion != null ? (
            <Text style={styles.line}>databaseVersion: {result.databaseVersion}</Text>
          ) : null}
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
