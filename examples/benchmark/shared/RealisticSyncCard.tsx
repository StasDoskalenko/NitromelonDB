import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BenchmarkTheme } from './BenchmarkScreen'
import { formatNumber } from './format'
import type { RealisticSyncOptions, RealisticSyncResult } from './realisticSyncBenchmark'

const PULL_COUNTS = [100, 300, 1000]

function formatMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

type Props = {
  theme: BenchmarkTheme
  run: (options: RealisticSyncOptions) => Promise<RealisticSyncResult>
}

// Same card in both apps. See realisticSyncBenchmark.ts and ../mock-server for the workload.
export function RealisticSyncCard({ theme, run }: Props) {
  const [pulls, setPulls] = useState(PULL_COUNTS[1]!)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RealisticSyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const styles = createStyles(theme)

  const start = async () => {
    if (running) {
      return
    }
    setRunning(true)
    setError(null)
    try {
      setResult(await run({ pulls }))
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunning(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Realistic sync</Text>
      <Text style={styles.hint}>
        Initial sync of a fresh install from the mock server (examples/benchmark/mock-server): 80
        tables, every response lists all of them, most pulls empty or tiny. Real fetch + JSON.parse
        per pull.
      </Text>

      <View style={styles.sizeRow}>
        {PULL_COUNTS.map((candidate) => (
          <Pressable
            key={candidate}
            testID={`real-size-${candidate}`}
            style={[
              styles.chip,
              pulls === candidate && styles.chipActive,
              running && styles.disabled,
            ]}
            onPress={() => setPulls(candidate)}
            disabled={running}
          >
            <Text style={[styles.chipLabel, pulls === candidate && styles.chipLabelActive]}>
              {formatNumber(candidate)} pulls
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        testID="real-run"
        style={[styles.button, running && styles.disabled]}
        onPress={() => void start()}
        disabled={running}
      >
        <Text style={styles.buttonLabel}>{running ? 'Running…' : 'Run realistic sync'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.tableCell}>Total</Text>
            <Text style={styles.tableCell}>Library</Text>
            <Text style={styles.tableCell}>Network</Text>
            <Text style={styles.tableCell}>Parse</Text>
            <Text style={styles.tableCell}>Open</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCell}>{formatMs(result.totalMs)}</Text>
            <Text style={styles.tableCell}>{formatMs(result.libraryMs)}</Text>
            <Text style={styles.tableCell}>{formatMs(result.networkMs)}</Text>
            <Text style={styles.tableCell}>{formatMs(result.parseMs)}</Text>
            <Text style={styles.tableCell}>{formatMs(result.openMs)}</Text>
          </View>
          <Text style={styles.memory}>
            {formatNumber(result.calls)} synchronize() calls, {formatNumber(result.records)}{' '}
            records, {(result.bytes / 1048576).toFixed(1)}MB of JSON. Library time per call: empty{' '}
            {result.libraryEmptyMedianMs.toFixed(1)}ms, 1–99 records{' '}
            {result.librarySmallMedianMs.toFixed(1)}ms
            {result.gcMs !== null ? `. ${result.gcCount} GCs, ${formatMs(result.gcMs)} in GC` : ''}
          </Text>
          {/* Machine-readable copy of the result for scripted runs (maestro hierarchy) */}
          <Text testID="real-json" style={styles.json}>
            {JSON.stringify(result)}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function createStyles(theme: BenchmarkTheme) {
  return StyleSheet.create({
    card: { marginTop: 20, backgroundColor: theme.card, borderRadius: 16, padding: 16 },
    cardTitle: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    hint: { color: theme.muted, fontSize: 13, lineHeight: 18 },
    sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    chip: {
      borderWidth: 1,
      borderColor: '#3f3f46',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipLabel: { color: theme.muted, fontSize: 13, fontWeight: '600' },
    chipLabelActive: { color: theme.accentText },
    button: {
      marginTop: 14,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
    },
    buttonLabel: { color: theme.accentText, fontSize: 15, fontWeight: '700' },
    disabled: { opacity: 0.45 },
    error: { marginTop: 10, color: theme.danger, fontSize: 13, lineHeight: 18 },
    table: { marginTop: 14 },
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
    tableCell: { flex: 1, color: theme.text, fontSize: 12, fontVariant: ['tabular-nums'] },
    memory: { marginTop: 10, color: theme.muted, fontSize: 12, lineHeight: 17 },
    json: { marginTop: 6, color: theme.muted, fontSize: 6, opacity: 0.5 },
  })
}
