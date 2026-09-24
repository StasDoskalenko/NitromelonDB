import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BenchmarkTheme } from './BenchmarkScreen'
import { formatNumber } from './format'
import type { SyncBenchmarkOptions, SyncBenchmarkResult } from './syncBenchmark'

const SIZES = [5_000, 20_000, 50_000]
const CHUNK_SIZE = 2_000
const PUSH_COUNT = 1_000

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`
}

function formatMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

type Props = {
  theme: BenchmarkTheme
  run: (options: SyncBenchmarkOptions) => Promise<SyncBenchmarkResult>
}

// Same card in both apps, so the numbers line up one to one. See syncBenchmark.ts for what each
// column measures.
export function SyncBenchmarkCard({ theme, run }: Props) {
  const [size, setSize] = useState(SIZES[1]!)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<SyncBenchmarkResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const styles = createStyles(theme)

  const start = async () => {
    if (running) {
      return
    }
    setRunning(true)
    setError(null)
    try {
      const result = await run({ records: size, chunkSize: CHUNK_SIZE, pushCount: PUSH_COUNT })
      setResults((current) => [result, ...current])
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunning(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Sync</Text>
      <Text style={styles.hint}>
        Pulls {formatNumber(size)} records ({formatNumber(CHUNK_SIZE)} per synchronize() call) as
        created, then again as updated, fetches them all, then pushes{' '}
        {formatNumber(PUSH_COUNT)} local changes. 12 columns per record.
      </Text>

      <View style={styles.sizeRow}>
        {SIZES.map((candidate) => (
          <Pressable
            key={candidate}
            testID={`sync-size-${candidate}`}
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
        testID="sync-run"
        style={[styles.button, running && styles.disabled]}
        onPress={() => void start()}
        disabled={running}
      >
        <Text style={styles.buttonLabel}>{running ? 'Running…' : 'Run sync benchmark'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {results.length > 0 ? (
        <View style={styles.table} testID="sync-results">
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableWide]}>Records</Text>
            <Text style={styles.tableCell}>Initial</Text>
            <Text style={styles.tableCell}>Update</Text>
            <Text style={styles.tableCell}>Fetch</Text>
            <Text style={styles.tableCell}>Push</Text>
            <Text style={styles.tableCell}>Total</Text>
          </View>
          {results.map((result, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <View key={index} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.tableWide]}>
                {formatNumber(result.records)}
              </Text>
              <Text style={styles.tableCell}>{formatMs(result.initialPullMs)}</Text>
              <Text style={styles.tableCell}>{formatMs(result.updatePullMs)}</Text>
              <Text style={styles.tableCell}>{formatMs(result.fetchAllMs)}</Text>
              <Text style={styles.tableCell}>{formatMs(result.pushMs)}</Text>
              <Text style={styles.tableCell}>{formatMs(result.totalMs)}</Text>
            </View>
          ))}
          {results[0]!.memory ? (
            <Text style={styles.memory}>
              Latest run: JS heap peak {formatMb(results[0]!.memory.heapPeakBytes)} (start{' '}
              {formatMb(results[0]!.memory.heapStartBytes)}), {results[0]!.memory.gcCount} GCs,{' '}
              {formatMs(results[0]!.memory.gcMs)} in GC
            </Text>
          ) : null}
          {/* Machine-readable copy of the latest result for scripted runs (maestro hierarchy) */}
          <Text testID="sync-json" style={styles.json}>
            {JSON.stringify(results[0])}
          </Text>
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
    memory: {
      marginTop: 10,
      color: theme.muted,
      fontSize: 12,
      lineHeight: 17,
    },
    json: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 6,
      opacity: 0.5,
    },
    tableWide: {
      flex: 1.2,
    },
  })
}
