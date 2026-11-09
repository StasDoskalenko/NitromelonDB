/** The flashlight metrics we chart, in display order. `better` drives the delta wording. */
export const ANDROID_METRICS = [
  { key: 'score', label: 'Flashlight score', unit: '/100', better: 'higher' },
  { key: 'cpu', label: 'CPU usage', unit: '%', better: 'lower' },
  { key: 'ram', label: 'RAM usage', unit: 'MB', better: 'lower' },
  { key: 'fps', label: 'FPS', unit: 'fps', better: 'higher' },
]

/**
 * The iOS sync benchmark metrics we chart (recorded by .github/workflows/perf-ios.yml; the full set
 * is in scripts/ios-sync-summary.mjs). `baseline` charts WatermelonDB JSI from the same CI job as a
 * dashed line. CI machines vary from run to run, so the overall "vs WatermelonDB" speedup (a
 * geometric mean, see flattenIosSync) is the steadiest signal; `parity` draws its 1× line.
 * `digits` and `flat` override the default formatting and no-change threshold, and `neutral` (the
 * runner baseline) skips the better/worse wording.
 */
export const IOS_SYNC_METRICS = [
  {
    key: 'sync50kTotalMs',
    label: 'Sync 50k records, total',
    unit: 'ms',
    better: 'lower',
    digits: 0,
    flat: 0.5,
    baseline: true,
  },
  {
    key: 'sync50kFetchAllMs',
    label: 'Sync 50k: one fetch of all records',
    unit: 'ms',
    better: 'lower',
    digits: 0,
    flat: 0.5,
    baseline: true,
  },
  {
    key: 'realisticLibraryMs',
    label: 'Realistic sync, library time',
    unit: 'ms',
    better: 'lower',
    digits: 0,
    flat: 0.5,
    baseline: true,
  },
  {
    key: 'stressScore',
    label: 'Stress test score',
    unit: 'ops/s',
    better: 'higher',
    digits: 0,
    flat: 0.5,
    baseline: true,
  },
  {
    key: 'speedupOverall',
    label: 'Overall vs WatermelonDB JSI',
    unit: '× faster',
    better: 'higher',
    digits: 2,
    flat: 0.005,
    parity: 1,
  },
  // How fast the CI machine was (scripts/runner-baseline.mjs), to tell a slower runner apart from a
  // slower NitromelonDB when comparing absolute times across runs. Not better or worse for us.
  {
    key: 'runnerSqliteMs',
    label: 'Runner baseline (SQLite workload)',
    unit: 'ms',
    neutral: true,
    digits: 0,
  },
]

export const BASELINE_LABEL = 'WatermelonDB JSI'

/** The key holding a metric's WatermelonDB JSI value on a chart row. */
export const baselineKey = (metric) => `${metric.key}Baseline`

const ratio = (faster, slower) => (faster > 0 && slower > 0 ? slower / faster : null)

// The geometric mean of NitromelonDB's speedups on one metric per workload, as in
// scripts/ios-sync-summary.mjs (for records from before it stored one)
function geomeanSpeedup(n, w) {
  const ratios = [
    ratio(n.sync5kTotalMs, w.sync5kTotalMs),
    ratio(n.sync50kTotalMs, w.sync50kTotalMs),
    ratio(n.realisticLibraryMs, w.realisticLibraryMs),
    n.stressScore > 0 && w.stressScore > 0 ? n.stressScore / w.stressScore : null,
  ]
  if (ratios.some((r) => r == null)) return null
  return Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length)
}

/**
 * A record's `iosSync` summary → flat chart values, WatermelonDB's under baselineKey(). Each app's
 * best run where the record has one (CI runners only ever slow runs down), else its median.
 */
function flattenIosSync(sync) {
  const hasBest = Boolean(sync.best?.nitromelondb)
  const nitromelondb = (hasBest ? sync.best.nitromelondb : sync.nitromelondb) ?? {}
  const watermelondb = (hasBest ? sync.best.watermelondb : sync.watermelondb) ?? {}
  const values = {}
  for (const metric of IOS_SYNC_METRICS) {
    if (!metric.baseline) continue
    values[metric.key] = nitromelondb[metric.key] ?? null
    values[baselineKey(metric)] = watermelondb[metric.key] ?? null
  }
  values.speedupOverall =
    (hasBest ? sync.geomean?.best : null) ?? geomeanSpeedup(nitromelondb, watermelondb)
  values.runnerSqliteMs = sync.baseline?.sqliteMs ?? null
  return values
}

/** Each chart section: its metrics, line color, and where a history record keeps its values. */
export const SOURCES = {
  android: {
    metrics: ANDROID_METRICS,
    color: 'var(--perf-chart-android)',
    values: (record) => record.android ?? null,
  },
  iosSync: {
    metrics: IOS_SYNC_METRICS,
    color: 'var(--perf-chart-ios)',
    values: (record) => (record.iosSync ? flattenIosSync(record.iosSync) : null),
  },
}

export const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
export const dateTimeFmt = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Number formatting for values and deltas: integers stay integers, the rest get one decimal,
 * unless the metric asks for more (`digits`).
 */
export function formatValue(value, metric) {
  if (value == null) return '–'
  if (metric?.digits != null) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: metric.digits,
      maximumFractionDigits: metric.digits,
    })
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * The change from `previous` to `current` for a metric: signed magnitude plus whether
 * it moved the good way. Changes below 0.05 count as flat (flashlight rounds to 0.1),
 * or below the metric's own `flat`.
 */
export function describeDelta(metric, current, previous) {
  if (current == null || previous == null || metric.neutral) return null
  const delta = current - previous
  if (Math.abs(delta) < (metric.flat ?? 0.05)) {
    return { delta: 0, text: 'no change', direction: 'flat' }
  }
  const improved = metric.better === 'lower' ? delta < 0 : delta > 0
  return {
    delta,
    text: `${delta > 0 ? '+' : '−'}${formatValue(Math.abs(delta), metric)}`,
    direction: improved ? 'better' : 'worse',
  }
}

/**
 * Runs per rolling-median window. Run-to-run noise on CI emulators/simulators (CPU swings ±3
 * points, RAM ±2 MB with no code change) is wider than most real changes, so a single run says
 * little; the median of 7 shrugs off one-off bad runs and still settles onto a real step within
 * 3-4 runs.
 */
export const TREND_WINDOW = 7

/** The key holding a metric's rolling median (the trend line) on a chart row. */
export const trendKey = (metric) => `${metric.key}Trend`

/** Fewer runs than this and there's no meaningful trend to draw yet. */
const MIN_TREND_RUNS = 5

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Per metric, over the runs that have a value:
 *   - row[trendKey]: centered rolling median (window shrinks at both ends), so a step change
 *     lines up with the merge that caused it instead of trailing it by half a window.
 *   - row.prior[key]: { value, runs } median of up to TREND_WINDOW runs before this one, the
 *     baseline a run's delta is measured against. With one prior run it's just "vs previous".
 * Computed on the full history so a range filter doesn't starve the window at its left edge.
 */
function addTrends(rows, metrics) {
  const half = TREND_WINDOW >> 1
  for (const row of rows) row.prior = {}
  for (const metric of metrics) {
    const series = rows.filter((row) => row[metric.key] != null)
    const values = series.map((row) => row[metric.key])
    series.forEach((row, i) => {
      if (series.length >= MIN_TREND_RUNS) {
        row[trendKey(metric)] = median(values.slice(Math.max(0, i - half), i + half + 1))
      }
      const before = values.slice(Math.max(0, i - TREND_WINDOW), i)
      if (before.length > 0) row.prior[metric.key] = { value: median(before), runs: before.length }
    })
  }
  return rows
}

/** "vs 7-run median" / "vs previous run": what describeDelta's baseline was. */
export function priorLabel(prior) {
  return prior.runs === 1 ? 'vs previous run' : `vs ${prior.runs}-run median`
}

/**
 * History records → chart rows for one source: one row per run that has its results, every
 * metric on the same row so charts share an index.
 */
export function toRows(history, source) {
  const { metrics, values } = SOURCES[source]
  const rows = history
    .map((record) => ({ record, recordValues: values(record) }))
    .filter(({ recordValues }) => recordValues != null)
    .map(({ record, recordValues }, index) => {
      const time = Date.parse(record.date)
      const row = {
        index,
        time: Number.isNaN(time) ? null : time,
        sha: record.sha ?? '',
        prNumber: record.prNumber ?? null,
        subject: record.subject ?? null,
      }
      for (const metric of metrics) {
        row[metric.key] = recordValues[metric.key] ?? null
        if (metric.baseline) row[baselineKey(metric)] = recordValues[baselineKey(metric)] ?? null
      }
      return row
    })
  return addTrends(rows, metrics)
}

/** Y-axis tick labels: compact for big numbers (114k), so they fit the axis. */
export function formatTick(value, metric) {
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000)}k`
  return formatValue(value, metric)
}
