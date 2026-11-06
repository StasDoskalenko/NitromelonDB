import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import useBaseUrl from '@docusaurus/useBaseUrl'
import React, { useEffect, useMemo, useState } from 'react'
import { MetricChart } from './MetricChart'
import { METRICS, dateTimeFmt, describeDelta, formatValue, toRows } from './metrics'
import styles from './styles.module.css'

const DAY = 24 * 60 * 60 * 1000
const RANGES = [
  { key: '30d', label: 'Last 30 days', ms: 30 * DAY },
  { key: '90d', label: 'Last 90 days', ms: 90 * DAY },
  { key: 'all', label: 'All runs', ms: null },
]

function useRepoUrl() {
  const { siteConfig } = useDocusaurusContext()
  return `https://github.com/${siteConfig.organizationName}/${siteConfig.projectName}`
}

function RangeFilter({ value, onChange }) {
  return (
    <div className={styles.filters} role="radiogroup" aria-label="Time range">
      {RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          role="radio"
          aria-checked={value === range.key}
          className={styles.filterButton}
          onClick={() => onChange(range.key)}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}

function CommitLinks({ row, previous, repoUrl }) {
  return (
    <>
      <a href={`${repoUrl}/commit/${row.sha}`} target="_blank" rel="noreferrer">
        <code>{row.sha.slice(0, 7)}</code>
      </a>
      {row.prNumber != null && (
        <>
          {' · '}
          <a href={`${repoUrl}/pull/${row.prNumber}`} target="_blank" rel="noreferrer">
            #{row.prNumber}
          </a>
        </>
      )}
      {previous && (
        <>
          {' · '}
          <a
            href={`${repoUrl}/compare/${previous.sha}...${row.sha}`}
            target="_blank"
            rel="noreferrer"
          >
            diff vs previous run
          </a>
        </>
      )}
    </>
  )
}

/** The clicked run: what it was, where to read the change, and every metric vs the run before it. */
function PinnedRun({ row, previous, repoUrl, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className={styles.pinned} aria-label="Selected run">
      <div className={styles.pinnedHead}>
        <div>
          <div className={styles.pinnedSubject}>{row.subject ?? row.sha}</div>
          <div className={styles.pinnedMeta}>
            {row.time != null && <>{dateTimeFmt.format(new Date(row.time))} · </>}
            <CommitLinks row={row} previous={previous} repoUrl={repoUrl} />
          </div>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Unpin run"
        >
          ×
        </button>
      </div>
      <dl className={styles.pinnedMetrics}>
        {METRICS.map((metric) => {
          const delta = describeDelta(metric, row[metric.key], previous?.[metric.key])
          return (
            <div key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>
                <strong>{formatValue(row[metric.key])}</strong>
                <span className={styles.latestUnit}>{metric.unit}</span>
                {delta && delta.direction !== 'flat' && (
                  <span className={styles.delta} data-direction={delta.direction}>
                    {delta.text} ({delta.direction})
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function RunsTable({ rows, repoUrl, onSelect }) {
  return (
    <details className={styles.tableWrap}>
      <summary>Show all {rows.length} runs as a table</summary>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Commit</th>
              {METRICS.map((m) => (
                <th key={m.key} className={styles.num}>
                  {m.label} ({m.unit})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((row) => (
              <tr key={`${row.sha}-${row.index}`}>
                <td className={styles.nowrap}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => onSelect(row.sha)}
                  >
                    {row.time != null
                      ? dateTimeFmt.format(new Date(row.time))
                      : `run ${row.index + 1}`}
                  </button>
                </td>
                <td>
                  <a href={`${repoUrl}/commit/${row.sha}`} target="_blank" rel="noreferrer">
                    <code>{row.sha.slice(0, 7)}</code>
                  </a>{' '}
                  {row.prNumber != null && (
                    <a href={`${repoUrl}/pull/${row.prNumber}`} target="_blank" rel="noreferrer">
                      #{row.prNumber}
                    </a>
                  )}
                  {row.subject && <div className={styles.tableSubject}>{row.subject}</div>}
                </td>
                {METRICS.map((m) => (
                  <td key={m.key} className={styles.num}>
                    {formatValue(row[m.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/**
 * Renders NotesApp perf-benchmark history (one point per merge to master,
 * appended by the perf-publish CI job) fetched client-side from the static
 * JSON synced onto this branch by scripts/update-docusaurus at build time.
 */
export default function PerformanceCharts() {
  const dataUrl = useBaseUrl('/data/benchmarks.json')
  const repoUrl = useRepoUrl()
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const [rangeKey, setRangeKey] = useState('all')
  const [pinnedSha, setPinnedSha] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(dataUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setHistory(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [dataUrl])

  const allRows = useMemo(() => (history ? toRows(history) : []), [history])

  const rows = useMemo(() => {
    const range = RANGES.find((r) => r.key === rangeKey)
    if (!range?.ms || allRows.length === 0) return allRows
    // Relative to the newest run, so the page still shows data if CI goes quiet for a while.
    const newest = allRows[allRows.length - 1].time ?? Date.now()
    return allRows.filter((r) => r.time == null || r.time >= newest - range.ms)
  }, [allRows, rangeKey])

  const pinnedPosition = pinnedSha != null ? allRows.findIndex((r) => r.sha === pinnedSha) : -1
  const pinned = pinnedPosition >= 0 ? allRows[pinnedPosition] : null
  const pinnedPrevious = pinnedPosition > 0 ? allRows[pinnedPosition - 1] : null
  const pinnedVisible = pinned != null && rows.includes(pinned)

  if (error != null) {
    return <p className={styles.empty}>Couldn&apos;t load benchmark history: {error}</p>
  }

  if (history == null) {
    return <p className={styles.empty}>Loading benchmark history…</p>
  }

  if (allRows.length === 0) {
    return (
      <p className={styles.empty}>
        No benchmark runs recorded yet. Data appears here after the first merge to{' '}
        <code>master</code> runs the perf CI job (see{' '}
        <code>scripts/ci-notesapp-android-maestro.sh</code>).
      </p>
    )
  }

  return (
    <>
      <div className={styles.toolbar}>
        <RangeFilter value={rangeKey} onChange={setRangeKey} />
        <p className={styles.caption}>
          {rows.length} of {allRows.length} run{allRows.length === 1 ? '' : 's'} · hover to compare
          all four metrics, click a run to pin it.
        </p>
      </div>

      {pinned && (
        <PinnedRun
          row={pinned}
          previous={pinnedPrevious}
          repoUrl={repoUrl}
          onClose={() => setPinnedSha(null)}
        />
      )}

      <div className={styles.grid}>
        {METRICS.map((metric) => (
          <MetricChart
            key={metric.key}
            rows={rows}
            metric={metric}
            pinnedIndex={pinnedVisible ? pinned.index : null}
            onSelect={setPinnedSha}
          />
        ))}
      </div>

      <RunsTable rows={rows} repoUrl={repoUrl} onSelect={setPinnedSha} />
    </>
  )
}
