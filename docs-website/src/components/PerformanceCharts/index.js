import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import useBaseUrl from '@docusaurus/useBaseUrl'
import React, { useEffect, useMemo, useState } from 'react'
import { MetricChart } from './MetricChart'
import {
  BASELINE_LABEL,
  SOURCES,
  TREND_WINDOW,
  dateTimeFmt,
  describeDelta,
  formatValue,
  priorLabel,
  toRows,
  trendKey,
} from './metrics'
import styles from './styles.module.css'

const DAY = 24 * 60 * 60 * 1000
const RANGES = [
  { key: '30d', label: 'Last 30 days', ms: 30 * DAY },
  { key: '90d', label: 'Last 90 days', ms: 90 * DAY },
  { key: 'all', label: 'All runs', ms: null },
]

// Both chart sections read the same file; fetch it once per page load
let historyRequest = null
function loadHistory(url) {
  historyRequest ??= fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  })
  return historyRequest
}

// Fewer runs with a machine factor than this, and charts start on raw values
const MIN_ADJUSTED_RUNS = 5

const MACHINE_MODES = [
  { key: 'adjusted', label: 'Adjusted for machine speed' },
  { key: 'raw', label: 'As measured' },
]

function useRepoUrl() {
  const { siteConfig } = useDocusaurusContext()
  return `https://github.com/${siteConfig.organizationName}/${siteConfig.projectName}`
}

/** Absolute times as recorded, or adjusted for each CI machine's speed (see addMachineFactors). */
function MachineFilter({ value, onChange }) {
  return (
    <div className={styles.filters} role="radiogroup" aria-label="Machine speed">
      {MACHINE_MODES.map((mode) => (
        <button
          key={mode.key}
          type="button"
          role="radio"
          aria-checked={value === mode.key}
          className={styles.filterButton}
          onClick={() => onChange(mode.key)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
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

/** The clicked run: what it was, where to read the change, and every metric vs the runs before it. */
function PinnedRun({ row, previous, metrics, repoUrl, onClose }) {
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
        {metrics.map((metric) => {
          const prior = row.prior?.[metric.key]
          const delta = prior && describeDelta(metric, row[metric.key], prior.value)
          return (
            <div key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>
                <strong>{formatValue(row[metric.key], metric)}</strong>
                <span className={styles.latestUnit}>{metric.unit}</span>
                {delta && delta.direction !== 'flat' && (
                  <span
                    className={styles.delta}
                    data-direction={delta.direction}
                    title={priorLabel(prior)}
                  >
                    {delta.text} ({delta.direction})
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className={styles.pinnedNote}>
        Changes are against the median of up to {TREND_WINDOW} runs before this one, so one noisy
        run doesn&apos;t read as a regression.
      </p>
    </section>
  )
}

function RunsTable({ rows, metrics, repoUrl, onSelect }) {
  return (
    <details className={styles.tableWrap}>
      <summary>Show all {rows.length} runs as a table</summary>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Commit</th>
              {metrics.map((m) => (
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
                {metrics.map((m) => (
                  <td key={m.key} className={styles.num}>
                    {formatValue(row[m.key], m)}
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
 * Renders one section of the perf-benchmark history (one point per merge to master, appended by
 * the perf-publish job in ci.yml for `android` and the publish job in perf-ios.yml for `iosSync`),
 * fetched client-side from the static JSON synced onto this branch by scripts/update-docusaurus at
 * build time. `empty` is shown until the section has its first run.
 */
export default function PerformanceCharts({ source = 'android', empty }) {
  const { metrics, color, adjustedCaption } = SOURCES[source]
  const dataUrl = useBaseUrl('/data/benchmarks.json')
  const repoUrl = useRepoUrl()
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const [rangeKey, setRangeKey] = useState('all')
  // null until picked: adjusted once enough runs have a machine factor (Android's history mostly
  // predates its reference build), raw times until then
  const [pickedMachineMode, setMachineMode] = useState(null)
  const [pinnedSha, setPinnedSha] = useState(null)
  const adjustable = metrics.some((metric) => metric.adjust)

  useEffect(() => {
    let cancelled = false
    loadHistory(dataUrl)
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

  const rawRows = useMemo(
    () => (history ? toRows(history, source, { adjusted: false }) : []),
    [history, source],
  )
  const machineMode =
    pickedMachineMode ??
    (rawRows.filter((row) => row.machineFactor != null).length >= MIN_ADJUSTED_RUNS
      ? 'adjusted'
      : 'raw')
  const allRows = useMemo(
    () =>
      history && machineMode === 'adjusted'
        ? toRows(history, source, { adjusted: true })
        : rawRows,
    [history, source, machineMode, rawRows],
  )

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
  const hasTrend = allRows.some((row) => metrics.some((m) => row[trendKey(m)] != null))

  if (error != null) {
    return <p className={styles.empty}>Couldn&apos;t load benchmark history: {error}</p>
  }

  if (history == null) {
    return <p className={styles.empty}>Loading benchmark history…</p>
  }

  if (allRows.length === 0) {
    return <p className={styles.empty}>{empty ?? 'No benchmark runs recorded yet.'}</p>
  }

  return (
    <div style={{ '--perf-series': color }}>
      <div className={styles.toolbar}>
        <RangeFilter value={rangeKey} onChange={setRangeKey} />
        {adjustable && <MachineFilter value={machineMode} onChange={setMachineMode} />}
        <p className={styles.caption}>
          {rows.length} of {allRows.length} run{allRows.length === 1 ? '' : 's'} · hover to compare
          every metric, click a run to pin it.
        </p>
      </div>
      {adjustable && (
        <p className={styles.caption}>
          {machineMode === 'adjusted'
            ? adjustedCaption
            : 'As measured. CI machines differ a lot in speed (see the last chart), so a slower machine shows up here as a slowdown.'}
        </p>
      )}
      <ul className={styles.legend} aria-label="Chart key">
        {hasTrend && (
          <li>
            <span className={styles.legendTrend} aria-hidden="true" />
            Trend (median of {TREND_WINDOW} runs)
          </li>
        )}
        <li>
          <span className={hasTrend ? styles.legendRun : styles.legendTrend} aria-hidden="true" />
          Each run
        </li>
        {metrics.some((m) => m.baseline || m.parity != null) && (
          <li>
            <span className={styles.legendBaseline} aria-hidden="true" />
            {BASELINE_LABEL}
          </li>
        )}
      </ul>

      {pinned && (
        <PinnedRun
          row={pinned}
          previous={pinnedPrevious}
          metrics={metrics}
          repoUrl={repoUrl}
          onClose={() => setPinnedSha(null)}
        />
      )}

      <div className={styles.grid}>
        {metrics.map((metric) => (
          <MetricChart
            key={metric.key}
            rows={rows}
            metric={metric}
            syncId={`perf-${source}`}
            pinnedIndex={pinnedVisible ? pinned.index : null}
            onSelect={setPinnedSha}
          />
        ))}
      </div>

      <RunsTable rows={rows} metrics={metrics} repoUrl={repoUrl} onSelect={setPinnedSha} />
    </div>
  )
}
