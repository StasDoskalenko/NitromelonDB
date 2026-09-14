import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BenchmarkTheme } from '../shared/BenchmarkScreen'
import { formatNumber } from '../shared/format'
import { runMassDeleteBenchmark, type MassDeleteResult } from './massDeleteBenchmark'

const SIZES = [1_000, 5_000, 20_000]

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`
}

type Props = {
  theme: BenchmarkTheme
}

// Reference point for the sibling NitromelonDB app's "Mass delete: old vs new" card: upstream
// WatermelonDB has no destroyMatching() equivalent, so this just times what
// Query#destroyAllPermanently() has always done here (one database.batch() call per matching
// record), at the same record counts, so the two cards are directly comparable.
export function MassDeleteBenchmarkCard({ theme }: Props) {
  const [size, setSize] = useState(SIZES[1]!)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<MassDeleteResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const styles = createStyles(theme)

  const run = async () => {
    if (running) {
      return
    }
    setRunning(true)
    setError(null)
    try {
      const result = await runMassDeleteBenchmark(size)
      setResults((current) => [result, ...current])
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunning(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Mass delete (reference)</Text>
      <Text style={styles.hint}>
        WatermelonDB's Query#destroyAllPermanently(): one transaction per matching record -- this
        is the number the NitromelonDB app's "old" column should roughly match, and what its "new"
        column improves on. Each run seeds {formatNumber(size)} rows and times destroying all of
        them.
      </Text>

      <View style={styles.sizeRow}>
        {SIZES.map((candidate) => (
          <Pressable
            key={candidate}
            style={[styles.chip, size === candidate && styles.chipActive, running && styles.disabled]}
            onPress={() => setSize(candidate)}
            disabled={running}
          >
            <Text style={[styles.chipLabel, size === candidate && styles.chipLabelActive]}>
              {formatNumber(candidate)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.button, running && styles.disabled]}
        onPress={() => void run()}
        disabled={running}
      >
        <Text style={styles.buttonLabel}>{running ? 'Running…' : 'Run'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {results.length > 0 ? (
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableWide]}>Records</Text>
            <Text style={styles.tableCell}>Time</Text>
          </View>
          {results.map((result, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <View key={index} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.tableWide]}>{formatNumber(result.count)}</Text>
              <Text style={styles.tableCell}>{formatMs(result.ms)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function createStyles(theme: BenchmarkTheme) {
  return StyleSheet.create({
    card: {
      marginTop: 20,
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 16,
    },
    cardTitle: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    hint: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
    },
    sizeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 14,
    },
    chip: {
      borderWidth: 1,
      borderColor: '#3f3f46',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    chipLabel: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '600',
    },
    chipLabelActive: {
      color: theme.accentText,
    },
    button: {
      marginTop: 14,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
    },
    buttonLabel: {
      color: theme.accentText,
      fontSize: 15,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.45,
    },
    error: {
      marginTop: 10,
      color: theme.danger,
      fontSize: 13,
      lineHeight: 18,
    },
    table: {
      marginTop: 14,
    },
    tableHeader: {
      flexDirection: 'row',
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#27272a',
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#18181b',
    },
    tableCell: {
      flex: 1,
      color: theme.text,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    tableWide: {
      flex: 1.4,
    },
  })
}
