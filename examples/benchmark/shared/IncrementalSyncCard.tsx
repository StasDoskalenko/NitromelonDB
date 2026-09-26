import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BenchmarkTheme } from './BenchmarkScreen'
import { formatNumber } from './format'
import type {
  IncrementalPhaseResult,
  IncrementalSyncOptions,
  IncrementalSyncResult,
} from './incrementalSyncBenchmark'

const SEED_SIZES = [2_000, 10_000]

function formatMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(ms < 100 ? 1 : 0)}ms`
}

type Props = {
  theme: BenchmarkTheme
  run: (options: IncrementalSyncOptions) => Promise<IncrementalSyncResult>
}

// Same card in both apps. See incrementalSyncBenchmark.ts for the workload.
export function IncrementalSyncCard({ theme, run }: Props) {
  const [seedPerTable, setSeedPerTable] = useState(SEED_SIZES[0]!)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<IncrementalSyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const styles = createStyles(theme)

  const start = async () => {
    if (running) {
      return
    }
    setRunning(true)
    setError(null)
    try {
      setResult(await run({ seedPerTable }))
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunning(false)
    }
  }

  const row = (label: string, phase: IncrementalPhaseResult) => (
    <View style={styles.tableRow}>
      <Text style={[styles.tableCell, styles.tableWide]}>{label}</Text>
      <Text style={styles.tableCell}>{formatMs(phase.empty.medianMs)}</Text>
      <Text style={styles.tableCell}>{formatMs(phase.small.medianMs)}</Text>
      <Text style={styles.tableCell}>{formatMs(phase.medium.medianMs)}</Text>
      <Text style={styles.tableCell}>{formatMs(phase.large.medianMs)}</Text>
      <Text style={styles.tableCell}>{formatMs(phase.totalMs)}</Text>
    </View>
  )

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Incremental sync</Text>
      <Text style={styles.hint}>
        Seeds 12 tables, then runs 67 synchronize() calls that are mostly empty or small, first
        with no observers, then with 3 observed queries per table. Cells are the median ms per
        call by records pulled (0 / 1–99 / 100–999 / 1,000+).
      </Text>

      <View style={styles.sizeRow}>
        {SEED_SIZES.map((candidate) => (
          <Pressable
            key={candidate}
            testID={`incr-size-${candidate}`}
            style={[
              styles.chip,
              seedPerTable === candidate && styles.chipActive,
              running && styles.disabled,
            ]}
            onPress={() => setSeedPerTable(candidate)}
            disabled={running}
          >
            <Text style={[styles.chipLabel, seedPerTable === candidate && styles.chipLabelActive]}>
              {formatNumber(candidate)} / table
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        testID="incr-run"
        style={[styles.button, running && styles.disabled]}
        onPress={() => void start()}
        disabled={running}
      >
        <Text style={styles.buttonLabel}>{running ? 'Running…' : 'Run incremental sync'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableWide]}>Observers</Text>
            <Text style={styles.tableCell}>0</Text>
            <Text style={styles.tableCell}>1–99</Text>
            <Text style={styles.tableCell}>100+</Text>
            <Text style={styles.tableCell}>1k+</Text>
            <Text style={styles.tableCell}>Total</Text>
          </View>
          {row('None', result.plain)}
          {row('36', result.observed)}
          <Text style={styles.memory}>
            Seed {formatMs(result.seedMs)}
            {result.observerErrors ? `, ${result.observerErrors} observer errors` : ''}
          </Text>
          {/* Machine-readable copy of the result for scripted runs (maestro hierarchy) */}
          <Text testID="incr-json" style={styles.json}>
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
    tableWide: { flex: 1.3 },
    memory: { marginTop: 10, color: theme.muted, fontSize: 12, lineHeight: 17 },
    json: { marginTop: 6, color: theme.muted, fontSize: 6, opacity: 0.5 },
  })
}
