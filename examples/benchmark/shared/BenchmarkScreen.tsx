import { StatusBar } from 'expo-status-bar'
import { useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { FULL_WORKLOAD, QUICK_WORKLOAD, type BenchmarkWorkload } from './config'
import { formatDuration, formatNumber, formatOps, phaseLabel } from './format'
import { runBenchmark } from './runBenchmark'
import type {
  BenchmarkAdapter,
  BenchmarkCancel,
  BenchmarkProgress,
  BenchmarkSummary,
} from './types'

export type BenchmarkTheme = {
  background: string
  card: string
  accent: string
  accentText: string
  muted: string
  text: string
  danger: string
}

type Props = {
  title: string
  subtitle: string
  adapter: BenchmarkAdapter | null
  setupError: string | null
  theme: BenchmarkTheme
}

const idleProgress = (workload: BenchmarkWorkload): BenchmarkProgress => ({
  phase: 'idle',
  round: 0,
  rounds: workload.rounds,
  records: workload.records,
  phaseDone: 0,
  phaseTotal: 1,
  elapsedMs: 0,
  roundsCompleted: [],
})

export function BenchmarkScreen({ title, subtitle, adapter, setupError, theme }: Props) {
  const [workload, setWorkload] = useState<BenchmarkWorkload>(FULL_WORKLOAD)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BenchmarkProgress>(() => idleProgress(FULL_WORKLOAD))
  const [summary, setSummary] = useState<BenchmarkSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<BenchmarkCancel>({ cancelled: false })

  const styles = useMemo(() => createStyles(theme), [theme])
  const phasePercent =
    progress.phaseTotal > 0 ? Math.min(100, (progress.phaseDone / progress.phaseTotal) * 100) : 0

  const start = async (next: BenchmarkWorkload) => {
    if (!adapter || running) {
      return
    }
    cancelRef.current = { cancelled: false }
    setWorkload(next)
    setRunning(true)
    setSummary(null)
    setError(null)
    setProgress(idleProgress(next))
    try {
      const result = await runBenchmark(adapter, next, setProgress, cancelRef.current)
      setSummary(result)
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunning(false)
    }
  }

  const stop = () => {
    cancelRef.current.cancelled = true
  }

  const blocked = Boolean(setupError) || !adapter

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>DATABASE STRESS TEST</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={styles.engine}>{adapter ? adapter.engine : 'Adapter failed to start'}</Text>

        <View style={styles.workloadRow}>
          <WorkloadChip
            label="Full · 1,000,000 × 20"
            active={workload === FULL_WORKLOAD}
            disabled={running}
            styles={styles}
            onPress={() => {
              setWorkload(FULL_WORKLOAD)
              if (!running) {
                setProgress(idleProgress(FULL_WORKLOAD))
              }
            }}
          />
          <WorkloadChip
            label="Quick · 100,000 × 10"
            active={workload === QUICK_WORKLOAD}
            disabled={running}
            styles={styles}
            onPress={() => {
              setWorkload(QUICK_WORKLOAD)
              if (!running) {
                setProgress(idleProgress(QUICK_WORKLOAD))
              }
            }}
          />
        </View>

        <Text style={styles.hint}>
          Each round writes {formatNumber(workload.records)} rows, runs count/filter/page queries,
          then permanently deletes {formatNumber(workload.records)} rows. That cycle repeats{' '}
          {workload.rounds} times. Batches of {formatNumber(workload.batchSize)} keep JS memory
          bounded.
        </Text>

        {setupError ? <Text style={styles.error}>{setupError}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryButton, (blocked || running) && styles.buttonDisabled]}
          onPress={() => void start(workload)}
          disabled={blocked || running}
        >
          <Text style={styles.primaryLabel}>{running ? 'Running…' : 'Start benchmark'}</Text>
        </Pressable>

        {running ? (
          <Pressable style={styles.stopButton} onPress={stop}>
            <Text style={styles.stopLabel}>Stop after this batch</Text>
          </Pressable>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live</Text>
          <Row label="Status" value={phaseLabel(progress.phase)} styles={styles} />
          <Row
            label="Round"
            value={progress.round === 0 ? '—' : `${progress.round} / ${progress.rounds}`}
            styles={styles}
          />
          <Row label="Elapsed" value={formatDuration(progress.elapsedMs)} styles={styles} />
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${phasePercent}%` }]} />
          </View>
          <Text style={styles.barCaption}>
            {progress.phase === 'write' || progress.phase === 'delete'
              ? `${formatNumber(progress.phaseDone)} / ${formatNumber(progress.phaseTotal)}`
              : `${Math.round(phasePercent)}%`}
          </Text>
        </View>

        {summary ? <ScoreCard summary={summary} styles={styles} /> : null}

        {progress.roundsCompleted.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rounds</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCell, styles.tableNarrow]}>#</Text>
              <Text style={styles.tableCell}>Write</Text>
              <Text style={styles.tableCell}>Query</Text>
              <Text style={styles.tableCell}>Delete</Text>
              <Text style={styles.tableCell}>Total</Text>
            </View>
            {progress.roundsCompleted.map((round) => (
              <View key={round.round} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableNarrow]}>{round.round}</Text>
                <Text style={styles.tableCell}>{formatDuration(round.writeMs)}</Text>
                <Text style={styles.tableCell}>{formatDuration(round.queryMs)}</Text>
                <Text style={styles.tableCell}>{formatDuration(round.deleteMs)}</Text>
                <Text style={styles.tableCell}>{formatDuration(round.totalMs)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <StatusBar style="light" />
    </View>
  )
}

function WorkloadChip({
  label,
  active,
  disabled,
  styles,
  onPress,
}: {
  label: string
  active: boolean
  disabled: boolean
  styles: ReturnType<typeof createStyles>
  onPress: () => void
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  )
}

function Row({
  label,
  value,
  styles,
}: {
  label: string
  value: string
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

function ScoreCard({
  summary,
  styles,
}: {
  summary: BenchmarkSummary
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View style={styles.scoreCard}>
      <Text style={styles.cardTitle}>{summary.cancelled ? 'Partial score' : 'Benchmark score'}</Text>
      <Text style={styles.score}>{formatNumber(summary.score)}</Text>
      <Text style={styles.scoreHint}>write + delete ops / second</Text>
      <Row label="Total time" value={formatDuration(summary.totalMs)} styles={styles} />
      <Row
        label="Rounds"
        value={`${summary.completedRounds} / ${summary.rounds}`}
        styles={styles}
      />
      <Row label="Writes" value={`${formatDuration(summary.writeMs)} · ${formatOps(summary.writesPerSec)}`} styles={styles} />
      <Row label="Queries" value={formatDuration(summary.queryMs)} styles={styles} />
      <Row
        label="Deletes"
        value={`${formatDuration(summary.deleteMs)} · ${formatOps(summary.deletesPerSec)}`}
        styles={styles}
      />
      <Row label="All ops" value={formatOps(summary.opsPerSec)} styles={styles} />
      <Row
        label="Round range"
        value={`${formatDuration(summary.fastestRoundMs)} – ${formatDuration(summary.slowestRoundMs)}`}
        styles={styles}
      />
    </View>
  )
}

function createStyles(theme: BenchmarkTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      paddingTop: 64,
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    kicker: {
      color: theme.accent,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.4,
    },
    title: {
      marginTop: 8,
      color: theme.text,
      fontSize: 32,
      fontWeight: '800',
    },
    subtitle: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 16,
      lineHeight: 22,
    },
    engine: {
      marginTop: 4,
      color: theme.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    workloadRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 20,
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
    hint: {
      marginTop: 14,
      color: theme.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    error: {
      marginTop: 12,
      color: theme.danger,
      fontSize: 14,
      lineHeight: 20,
    },
    primaryButton: {
      marginTop: 22,
      backgroundColor: theme.accent,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
    },
    primaryLabel: {
      color: theme.accentText,
      fontSize: 18,
      fontWeight: '800',
    },
    stopButton: {
      marginTop: 10,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.danger,
    },
    stopLabel: {
      color: theme.danger,
      fontSize: 15,
      fontWeight: '700',
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    card: {
      marginTop: 20,
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 16,
    },
    scoreCard: {
      marginTop: 20,
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.accent,
    },
    cardTitle: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    score: {
      color: theme.text,
      fontSize: 48,
      fontWeight: '800',
      letterSpacing: -1,
    },
    scoreHint: {
      color: theme.muted,
      fontSize: 13,
      marginBottom: 14,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 6,
    },
    rowLabel: {
      color: theme.muted,
      fontSize: 14,
    },
    rowValue: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'right',
      flexShrink: 1,
    },
    barTrack: {
      marginTop: 12,
      height: 8,
      borderRadius: 999,
      backgroundColor: '#27272a',
      overflow: 'hidden',
    },
    barFill: {
      height: 8,
      backgroundColor: theme.accent,
    },
    barCaption: {
      marginTop: 8,
      color: theme.muted,
      fontSize: 12,
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
    tableNarrow: {
      flex: 0.4,
    },
  })
}
