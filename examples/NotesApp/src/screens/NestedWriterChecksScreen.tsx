import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  type CheckResult,
  describeContextTier,
  describeEngine,
  NESTED_WRITER_CHECK_COUNT,
  runNestedWriterChecks,
} from '../nestedWriterChecks'
import { useScreenInsets } from '../hooks/useScreenInsets'
import { colors } from '../theme'

type NestedWriterChecksScreenProps = {
  onClose: () => void
}

export function NestedWriterChecksScreen({ onClose }: NestedWriterChecksScreenProps) {
  const [results, setResults] = useState<CheckResult[]>([])
  const [running, setRunning] = useState(false)
  const insets = useScreenInsets()

  const run = useCallback(() => {
    setResults([])
    setRunning(true)
    runNestedWriterChecks((result) => setResults((previous) => [...previous, result]))
      .catch((error: unknown) =>
        setResults((previous) => [
          ...previous,
          { id: 'runner', label: 'Runner', status: 'fail', detail: String(error) },
        ]),
      )
      .finally(() => setRunning(false))
  }, [])

  useEffect(run, [run])

  const counted = results.filter((result) => !result.informational)
  const passed = counted.filter((result) => result.status === 'pass').length
  const expected = NESTED_WRITER_CHECK_COUNT - 1 // minus the informational one
  let summary = `Running… ${results.length}/${NESTED_WRITER_CHECK_COUNT}`
  if (!running) {
    summary =
      passed === expected && counted.length === expected
        ? `ALL PASSED (${passed}/${expected})`
        : `FAILED (${passed}/${expected} passed)`
  }

  return (
    <View style={[styles.screen, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 24) }]}>
        <Text style={styles.title}>Nested writer checks</Text>
        <Text style={styles.meta} testID="nested-checks-engine">
          {describeEngine()} · context: {describeContextTier()}
        </Text>
        <Text style={styles.summary} testID="nested-checks-summary" accessible>
          {summary}
        </Text>
        <View style={styles.actions}>
          <Pressable
            style={styles.button}
            onPress={run}
            disabled={running}
            testID="nested-checks-rerun"
          >
            <Text style={styles.buttonText}>Run again</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={onClose} testID="nested-checks-close">
            <Text style={styles.buttonText}>Back to notes</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {results.map((result) => (
          <View key={result.id} style={styles.row} testID={`nested-check-${result.id}`}>
            <Text
              style={[styles.status, result.status === 'fail' && styles.statusFail]}
              testID={`nested-check-${result.id}-status`}
            >
              {result.status.toUpperCase()}
            </Text>
            <View style={styles.rowText}>
              <Text style={styles.label}>{result.label}</Text>
              <Text style={styles.detail}>{result.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },
  summary: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderInput,
    backgroundColor: colors.surface,
  },
  buttonText: {
    fontSize: 14,
    color: colors.text,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  status: {
    width: 64,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  statusFail: {
    color: colors.danger,
  },
  rowText: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    color: colors.text,
  },
  detail: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
})
