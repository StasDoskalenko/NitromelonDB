import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BenchmarkTheme } from './BenchmarkScreen'
import { formatNumber } from './format'
import type { CompetingWorkOptions, CompetingWorkResult } from './competingWorkBenchmark'

type Preset = { label: string; options: CompetingWorkOptions }

// "Light" is roughly a periodic sync + a couple of user actions + a couple of on-screen
// queries. "Heavy" pushes well past what a real app should ever fire at once, specifically to
// make queue pile-up (and therefore warnings) easy to trigger on demand.
const PRESETS: Preset[] = [
  {
    label: 'Light · 3w × 2r',
    options: { writerCallers: 3, readerCallers: 2, opsPerCaller: 20, workMs: 20 },
  },
  {
    label: 'Heavy · 8w × 6r',
    options: { writerCallers: 8, readerCallers: 6, opsPerCaller: 30, workMs: 30 },
  },
  {
    label: 'Extreme · 15w × 10r',
    options: { writerCallers: 15, readerCallers: 10, opsPerCaller: 40, workMs: 40 },
  },
]

type RunOutcome = { result: CompetingWorkResult; warnings: number; messages: string[] }

type Props = {
  theme: BenchmarkTheme
  run: (options: CompetingWorkOptions) => Promise<RunOutcome>
}

// Same card in both apps: fires several independent, uncoordinated writer/reader "callers" at
// the same Database (see competingWorkBenchmark.ts) and counts how many dev-mode queue
// warnings that produces. That count -- not wall time -- is the number this card exists to show.
export function CompetingWorkBenchmarkCard({ theme, run }: Props) {
  const [preset, setPreset] = useState<Preset>(PRESETS[0]!)
  const [running, setRunning] = useState(false)
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([])
  const [error, setError] = useState<string | null>(null)

  const styles = createStyles(theme)

  const start = async () => {
    if (running) {
      return
    }
    setRunning(true)
    setError(null)
    try {
      const outcome = await run(preset.options)
      setOutcomes((current) => [outcome, ...current])
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunning(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Competing writers/readers</Text>
      <Text style={styles.hint}>
        Fires {preset.options.writerCallers} writer and {preset.options.readerCallers} reader
        &ldquo;callers&rdquo; at once -- none aware of the others, most unnamed --{' '}
        {preset.options.opsPerCaller}{' '}
        ops each, ~{preset.options.workMs}ms of simulated work per op. Counts dev-mode queue
        warnings, not just timing.
      </Text>

      <View style={styles.presetRow}>
        {PRESETS.map((candidate) => (
          <Pressable
            key={candidate.label}
            testID={`competing-preset-${candidate.label}`}
            style={[
              styles.chip,
              preset.label === candidate.label && styles.chipActive,
              running && styles.disabled,
            ]}
            onPress={() => setPreset(candidate)}
            disabled={running}
          >
            <Text
              style={[styles.chipLabel, preset.label === candidate.label && styles.chipLabelActive]}
            >
              {candidate.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        testID="competing-run"
        style={[styles.button, running && styles.disabled]}
        onPress={() => void start()}
        disabled={running}
      >
        <Text style={styles.buttonLabel}>{running ? 'Running…' : 'Run competing writers/readers'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {outcomes.length > 0 ? (
        <View style={styles.table} testID="competing-results">
          {outcomes.map((outcome, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <View key={index} style={styles.row}>
              <View style={styles.warningBadgeRow}>
                <Text
                  style={[
                    styles.warningBadge,
                    outcome.warnings === 0 ? styles.warningBadgeZero : styles.warningBadgeSome,
                  ]}
                >
                  {formatNumber(outcome.warnings)} warning{outcome.warnings === 1 ? '' : 's'}
                </Text>
                <Text style={styles.rowMeta}>
                  {formatNumber(outcome.result.totalOps)} ops · {Math.round(outcome.result.totalMs)}ms
                </Text>
              </View>
              {outcome.messages[0] ? (
                <Text style={styles.sample} numberOfLines={3}>
                  {outcome.messages[0]}
                </Text>
              ) : null}
            </View>
          ))}
          {/* Machine-readable copy of the latest run for scripted comparisons (maestro hierarchy) */}
          <Text testID="competing-json" style={styles.json}>
            {JSON.stringify({
              warnings: outcomes[0]!.warnings,
              totalOps: outcomes[0]!.result.totalOps,
              totalMs: outcomes[0]!.result.totalMs,
              options: outcomes[0]!.result.options,
            })}
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
    presetRow: {
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
    row: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#18181b',
    },
    warningBadgeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    warningBadge: {
      fontSize: 14,
      fontWeight: '800',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    warningBadgeZero: {
      color: '#4ade80',
      backgroundColor: 'rgba(74, 222, 128, 0.12)',
    },
    warningBadgeSome: {
      color: theme.danger,
      backgroundColor: 'rgba(248, 113, 113, 0.12)',
    },
    rowMeta: {
      color: theme.muted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    sample: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 11,
      lineHeight: 15,
    },
    json: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 6,
      opacity: 0.5,
    },
  })
}
