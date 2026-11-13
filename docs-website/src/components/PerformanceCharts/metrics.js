/**
 * The flashlight metrics we chart, in display order. `better` drives the delta wording. `adjust`
 * metrics are adjusted for the CI machine's speed by default (see addReferenceFactors); RAM
 * doesn't depend on it.
 */
export const ANDROID_METRICS = [
  { key: 'score', label: 'Flashlight score', unit: '/100', better: 'higher', adjust: true },
  { key: 'cpu', label: 'CPU usage', unit: '%', better: 'lower', adjust: true },
  { key: 'ram', label: 'RAM usage', unit: 'MB', better: 'lower' },
  { key: 'fps', label: 'FPS', unit: 'fps', better: 'higher', adjust: true },
  // How slow this job's CI machine was: the reference build's CPU relative to its usual (see
  // addReferenceFactors). Not better or worse for us.
  {
    key: 'machineFactor',
    label: 'CI machine speed (reference build’s CPU vs its median)',
    unit: '× its usual CPU',
    neutral: true,
    digits: 2,
  },
]

/**
 * The iOS sync benchmark metrics we chart (recorded by .github/workflows/perf-ios.yml; the full set
 * is in scripts/ios-sync-summary.mjs). `baseline` charts WatermelonDB JSI from the same CI job as a
 * dashed line. CI machines vary from run to run, so the overall "vs WatermelonDB" speedup (a
 * geometric mean, see flattenIosSync) is the steadiest signal; `parity` draws its 1× line.
 * `adjust` metrics are absolute times (or a score), which are adjusted for the CI machine's speed
 * by default (see addMachineFactors). `digits` and `flat` override the default formatting and
 * no-change threshold, and `neutral` (the machine factor) skips the better/worse wording.
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
    adjust: true,
  },
  {
    key: 'sync50kFetchAllMs',
    label: 'Sync 50k: one fetch of all records',
    unit: 'ms',
    better: 'lower',
    digits: 0,
    flat: 0.5,
    baseline: true,
    adjust: true,
  },
  {
    key: 'realisticLibraryMs',
    label: 'Realistic sync, library time',
    unit: 'ms',
    better: 'lower',
    digits: 0,
    flat: 0.5,
    baseline: true,
    adjust: true,
  },
  {
    key: 'stressScore',
    label: 'Stress test score',
    unit: 'ops/s',
    better: 'higher',
    digits: 0,
    flat: 0.5,
    baseline: true,
    adjust: true,
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
  // How slow this job's CI machine was: WatermelonDB's time relative to its usual (see
  // addMachineFactors). The `adjust` metrics are divided by it. Not better or worse for us.
  {
    key: 'machineFactor',
    label: 'CI machine speed (WatermelonDB vs its median)',
    unit: '× its usual time',
    neutral: true,
    digits: 2,
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
 * The workloads that measure a CI job's machine: WatermelonDB 0.28 never changes and runs in the
 * same simulator, in the same job, so how its times compare with its usual ones says how slow that
 * job's machine was. (scripts/runner-baseline.mjs times a fixed workload too, but in Node on the
 * host, outside the simulator; adjusting by it made run-to-run variation larger, not smaller.)
 */
const MACHINE_WORKLOADS = [
  { key: 'sync5kTotalMs', better: 'lower' },
  { key: 'sync50kTotalMs', better: 'lower' },
  { key: 'realisticLibraryMs', better: 'lower' },
  { key: 'stressScore', better: 'higher' },
]

/**
 * Sets row.machineFactor: how much slower than usual this job's machine was (1.2 = WatermelonDB
 * took 1.2× its median time), the geometric mean over MACHINE_WORKLOADS, each against its median
 * over the whole history. With `adjusted`, the `adjust` metrics (NitromelonDB's and WatermelonDB's)
 * are divided by it (a score is multiplied), so they read as if every job had run on a machine of
 * median speed. On recorded runs this halves the run-to-run variation of the 50k sync and fetch
 * times. Rows without every workload get no factor, and no adjusted values.
 */
function addMachineFactors(rows, metrics, workloadsByRow, adjusted) {
  const medians = Object.fromEntries(
    MACHINE_WORKLOADS.map(({ key }) => {
      const values = workloadsByRow.map((w) => w?.[key]).filter((v) => v > 0)
      return [key, values.length > 0 ? median(values) : null]
    }),
  )
  rows.forEach((row, i) => {
    const workloads = workloadsByRow[i]
    const logs = MACHINE_WORKLOADS.map(({ key, better }) => {
      const value = workloads?.[key]
      if (!(value > 0) || !(medians[key] > 0)) return null
      return Math.log(better === 'lower' ? value / medians[key] : medians[key] / value)
    })
    const factor = logs.every((l) => l != null)
      ? Math.exp(logs.reduce((sum, l) => sum + l, 0) / logs.length)
      : null
    row.machineFactor = factor
    if (!adjusted) return
    for (const metric of metrics) {
      if (!metric.adjust) continue
      for (const key of [metric.key, baselineKey(metric)]) {
        if (row[key] == null) continue
        row[key] =
          factor == null ? null : metric.better === 'lower' ? row[key] / factor : row[key] * factor
      }
    }
  })
  return rows
}

/**
 * The Android counterpart of addMachineFactors, as in scripts/android-machine-factor.mjs (which the
 * PR comment uses). The flashlight job measures a fixed reference build (a NotesApp tag, recorded
 * as `androidReference`) in turns with each commit's, on the same emulator. Per `adjust` metric,
 * the factor is the reference's value against its median over every run measured with the same
 * tag (1.1 = it used 1.1× its usual CPU, or got 1/1.1 of its usual FPS), and the commit's value is
 * divided by it (FPS and score multiplied). Each metric gets its own factor: a slow machine moves
 * CPU much more than FPS. row.machineFactor is the CPU one. Rows without a reference get no factor,
 * and no adjusted values.
 */
function addReferenceFactors(rows, metrics, references, adjusted) {
  const adjustMetrics = metrics.filter((metric) => metric.adjust)
  const medians = {}
  for (const reference of references) {
    if (!reference?.reference) continue
    medians[reference.reference] ??= {}
  }
  for (const tag of Object.keys(medians)) {
    const sameTag = references.filter((reference) => reference?.reference === tag)
    for (const { key } of adjustMetrics) {
      const values = sameTag.map((reference) => reference[key]).filter((v) => v > 0)
      medians[tag][key] = values.length > 0 ? median(values) : null
    }
  }
  rows.forEach((row, i) => {
    const reference = references[i]
    const usual = reference?.reference ? medians[reference.reference] : null
    const factors = Object.fromEntries(
      adjustMetrics.map(({ key, better }) => {
        const value = reference?.[key]
        if (!(value > 0) || !(usual?.[key] > 0)) return [key, null]
        return [key, better === 'lower' ? value / usual[key] : usual[key] / value]
      }),
    )
    row.machineFactor = factors.cpu ?? null
    if (!adjusted) return
    for (const { key, better } of adjustMetrics) {
      if (row[key] == null) continue
      const factor = factors[key]
      row[key] = factor == null ? null : better === 'lower' ? row[key] / factor : row[key] * factor
      if (key === 'score' && row[key] != null) row[key] = Math.min(100, row[key])
    }
  })
  return rows
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
  values.machineWorkloads = Object.fromEntries(
    MACHINE_WORKLOADS.map(({ key }) => [key, watermelondb[key] ?? null]),
  )
  return values
}

/** Each chart section: its metrics, line color, and where a history record keeps its values. */
export const SOURCES = {
  android: {
    metrics: ANDROID_METRICS,
    color: 'var(--perf-chart-android)',
    values: (record) =>
      record.android ? { ...record.android, machineReference: record.androidReference ?? null } : null,
    adjustRows: (rows, metrics, recordValues, adjusted) =>
      addReferenceFactors(
        rows,
        metrics,
        recordValues.map((values) => values.machineReference),
        adjusted,
      ),
    adjustedCaption:
      'CPU, FPS and score are adjusted for how fast each CI machine was, measured by a fixed NotesApp build in the same job (the last chart), as if every run had a machine of median speed. RAM doesn’t depend on machine speed. Runs from before the reference build was measured have no adjusted values.',
  },
  iosSync: {
    metrics: IOS_SYNC_METRICS,
    color: 'var(--perf-chart-ios)',
    values: (record) => (record.iosSync ? flattenIosSync(record.iosSync) : null),
    adjustRows: (rows, metrics, recordValues, adjusted) =>
      addMachineFactors(
        rows,
        metrics,
        recordValues.map((values) => values.machineWorkloads),
        adjusted,
      ),
    adjustedCaption:
      'Times are adjusted for how fast each CI machine was, measured by WatermelonDB in the same job (the last chart), as if every run had a machine of median speed.',
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
 * metric on the same row so charts share an index. `adjusted` (the default) adjusts values for
 * each CI machine's speed (addMachineFactors for iOS sync, addReferenceFactors for Android).
 */
export function toRows(history, source, { adjusted = true } = {}) {
  const { metrics, values, adjustRows } = SOURCES[source]
  const recorded = history
    .map((record) => ({ record, recordValues: values(record) }))
    .filter(({ recordValues }) => recordValues != null)
  const rows = recorded.map(({ record, recordValues }, index) => {
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
  if (adjustRows) {
    adjustRows(
      rows,
      metrics,
      recorded.map(({ recordValues }) => recordValues),
      adjusted,
    )
  }
  return addTrends(rows, metrics)
}

/** Y-axis tick labels: compact for big numbers (114k), so they fit the axis. */
export function formatTick(value, metric) {
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000)}k`
  return formatValue(value, metric)
}
