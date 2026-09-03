import { useEffect, useState } from 'react'
import { ScrollView, Text } from 'react-native'

type Failure = { name: string; error: string }
type Report = { total: number; passed: number; failures: Failure[] }
type Progress = { current: number; total: number; name: string }

export default function WebAdapterTestScreen() {
  const [report, setReport] = useState<Report | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)

  useEffect(() => {
    let active = true
    const runner = require('../webAdapterTests/runner').default as (
      onProgress: (next: Progress) => void,
    ) => Promise<Report>
    runner((next) => active && setProgress(next)).then(
      (result) => active && setReport(result),
      (error: unknown) =>
        active &&
        setReport({
          total: 1,
          passed: 0,
          failures: [
            {
              name: 'web adapter test runner',
              error: error instanceof Error ? error.stack || error.message : String(error),
            },
          ],
        }),
    )
    return () => {
      active = false
    }
  }, [])

  const status = !report
    ? progress
      ? `Running: ${progress.current}/${progress.total} ${progress.name}`
      : 'Running'
    : report.failures.length
      ? `Failed: ${report.failures.length}/${report.total}`
      : `Done: ${report.passed}/${report.total}`

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Text testID="adapter-tests-status">{status}</Text>
      {report?.failures.map((failure) => (
        <Text key={failure.name} testID="adapter-test-failure">
          {failure.name}: {failure.error}
        </Text>
      ))}
    </ScrollView>
  )
}
