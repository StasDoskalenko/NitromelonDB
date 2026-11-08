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
 * dashed line. CI machines vary from run to run, so the two "vs WatermelonDB" ratios are the
 * steadiest signal; `parity` draws their 1× line. `digits` and `flat` override the default
 * formatting and no-change threshold.
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
    key: 'speedupSync50k',
    label: 'Sync 50k vs WatermelonDB JSI',
    unit: '× faster',
    better: 'higher',
    digits: 2,
    flat: 0.005,
    parity: 1,
  },
  {
    key: 'speedupRealistic',
    label: 'Realistic sync vs WatermelonDB JSI',
    unit: '× faster',
    better: 'higher',
    digits: 2,
    flat: 0.005,
    parity: 1,
  },
]

export const BASELINE_LABEL = 'WatermelonDB JSI'

/** The key holding a metric's WatermelonDB JSI value on a chart row. */
export const baselineKey = (metric) => `${metric.key}Baseline`

const ratio = (faster, slower) => (faster > 0 && slower > 0 ? slower / faster : null)

/** A record's `iosSync` summary → flat chart values, WatermelonDB's under baselineKey(). */
function flattenIosSync({ nitromelondb = {}, watermelondb = {} }) {
  const values = {}
  for (const metric of IOS_SYNC_METRICS) {
    if (!metric.baseline) continue
    values[metric.key] = nitromelondb[metric.key] ?? null
    values[baselineKey(metric)] = watermelondb[metric.key] ?? null
  }
  values.speedupSync50k = ratio(nitromelondb.sync50kTotalMs, watermelondb.sync50kTotalMs)
  values.speedupRealistic = ratio(nitromelondb.realisticLibraryMs, watermelondb.realisticLibraryMs)
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
  if (current == null || previous == null) return null
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
 * History records → chart rows for one source: one row per run that has its results, every
 * metric on the same row so charts share an index.
 */
export function toRows(history, source) {
  const { metrics, values } = SOURCES[source]
  return history
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
}

/** Y-axis tick labels: compact for big numbers (114k), so they fit the axis. */
export function formatTick(value, metric) {
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000)}k`
  return formatValue(value, metric)
}
