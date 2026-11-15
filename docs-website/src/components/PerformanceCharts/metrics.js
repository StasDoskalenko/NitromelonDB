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
 * by default, each by WatermelonDB's result on the same workload, or on `machineWorkload` (see
 * addMachineFactors). `digits` and `flat` override the default formatting and
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
    // WatermelonDB's fetch alone is a poor measure of the machine: in some jobs most of its fetches
    // took 2-4x the others (1-1.9 s vs ~0.4 s) while the rest of the sync didn't. The whole 50k
    // sync of the same runs, which the fetch is part of, varies 6.9% from job to job this way, vs
    // 16.8% by the fetch itself.
    machineWorkload: 'sync50kTotalMs',
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
  // How slow this job's CI machine was: WatermelonDB's time relative to its usual, over the four
  // workloads (see addMachineFactors). Each `adjust` metric uses its own workload's instead. Not
  // better or worse for us.
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

/** NitromelonDB's speedup on one metric (> 1 = faster), from two values of it. */
const speedupOf = (metric, n, w) =>
  metric.better === 'higher' ? (n > 0 && w > 0 ? n / w : null) : ratio(n, w)

const geomean = (ratios) =>
  ratios.length > 0 && ratios.every((r) => r > 0)
    ? Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length)
    : null

/**
 * The workloads the overall speedup averages and that measure a CI job's machine, one metric per
 * workload (as GEOMEAN_METRICS in scripts/ios-sync-summary.mjs).
 */
const MACHINE_WORKLOADS = [
  { key: 'sync5kTotalMs', better: 'lower' },
  { key: 'sync50kTotalMs', better: 'lower' },
  { key: 'realisticLibraryMs', better: 'lower' },
  { key: 'stressScore', better: 'higher' },
]

/**
 * NitromelonDB's speedup over WatermelonDB on `metric` in one record, the steadiest estimate it
 * has, as steadySpeedups in scripts/ios-sync-summary.mjs: `paired` (the median of the speedups of
 * runs side by side), else the ratio of the medians. Never the best runs: one extreme sample per
 * app, which across master's history varied 3x more from job to job.
 */
function steadySpeedup(sync, metric) {
  return (
    sync.paired?.[metric.key] ??
    speedupOf(metric, sync.nitromelondb?.[metric.key], sync.watermelondb?.[metric.key])
  )
}

/**
 * Adjusts the iOS values for each CI job's machine. WatermelonDB 0.28 never changes and runs in
 * turns with NitromelonDB in the same simulator, in the same job, so it measures that job's
 * machine. Each metric is adjusted by WatermelonDB's own result on the same workload (or its
 * `machineWorkload`, from the same runs), never by a mix of workloads: a slow moment for the sync
 * cards says little about the stress test minutes later (WatermelonDB's stress and sync results
 * correlate at r = 0.15-0.28 across jobs).
 *
 * WatermelonDB's usual value for a metric is the median of its per-job medians over the history.
 * (Medians, because every record has them; records from before #220 have no best runs, and mixing
 * the two made later jobs look like faster machines.) A job's adjusted NitromelonDB value is that
 * usual value divided by its speedup (a score multiplied): what NitromelonDB would have measured
 * on a machine where WatermelonDB measured its usual. WatermelonDB's adjusted value is then its
 * usual one, so its dashed line is flat. A metric with a `machineWorkload` has both apps' values
 * divided by WatermelonDB's factor on that workload instead (its value vs its usual).
 *
 * row.machineFactor: how much slower than usual the job's machine was (1.2 = WatermelonDB took
 * 1.2x its usual time), the geometric mean over MACHINE_WORKLOADS. Shown for reference, not used
 * for adjusting. Rows without every workload get no factor.
 */
function addMachineFactors(rows, metrics, recordValues, adjusted) {
  const usual = (key) => {
    const values = recordValues.map((values) => values.watermelondb?.[key]).filter((v) => v > 0)
    return values.length > 0 ? median(values) : null
  }
  const keys = [
    ...MACHINE_WORKLOADS.map(({ key }) => key),
    ...metrics.flatMap(({ key, machineWorkload }) => [key, machineWorkload]),
  ]
  const usuals = Object.fromEntries(
    [...new Set(keys.filter(Boolean))].map((key) => [key, usual(key)]),
  )
  rows.forEach((row, i) => {
    const { watermelondb, speedups } = recordValues[i]
    const factors = MACHINE_WORKLOADS.map(({ key, better }) => {
      const value = watermelondb?.[key]
      if (!(value > 0) || !(usuals[key] > 0)) return null
      return better === 'lower' ? value / usuals[key] : usuals[key] / value
    })
    row.machineFactor = factors.every((f) => f != null) ? geomean(factors) : null
    if (!adjusted) return
    for (const metric of metrics) {
      if (!metric.adjust) continue
      const reference = metric.machineWorkload ?? metric.key
      if (reference !== metric.key) {
        // Adjusted by another workload's factor: both apps' values divided by it (a score multiplied)
        const value = watermelondb?.[reference]
        const factor = value > 0 && usuals[reference] > 0 ? value / usuals[reference] : null
        for (const key of [metric.key, baselineKey(metric)]) {
          if (row[key] == null) continue
          row[key] =
            factor == null
              ? null
              : metric.better === 'lower'
                ? row[key] / factor
                : row[key] * factor
        }
        continue
      }
      const speedup = speedups?.[metric.key]
      const base = usuals[metric.key]
      const known = speedup > 0 && base > 0 && row[metric.key] != null
      row[metric.key] = known ? (metric.better === 'lower' ? base / speedup : base * speedup) : null
      if (metric.baseline && row[baselineKey(metric)] != null) {
        row[baselineKey(metric)] = known ? base : null
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
 * median run: every record has those, so the history compares like with like (best runs only
 * exist from #220 on). `speedups` and `watermelondb` feed addMachineFactors.
 */
function flattenIosSync(sync) {
  const nitromelondb = sync.nitromelondb ?? {}
  const watermelondb = sync.watermelondb ?? {}
  const values = {}
  for (const metric of IOS_SYNC_METRICS) {
    if (!metric.baseline) continue
    values[metric.key] = nitromelondb[metric.key] ?? null
    values[baselineKey(metric)] = watermelondb[metric.key] ?? null
  }
  const speedups = {}
  for (const metric of [...IOS_SYNC_METRICS, ...MACHINE_WORKLOADS]) {
    if (metric.better) speedups[metric.key] = steadySpeedup(sync, metric)
  }
  values.speedupOverall = geomean(MACHINE_WORKLOADS.map(({ key }) => speedups[key]))
  values.speedups = speedups
  values.watermelondb = watermelondb
  return values
}

/** Each chart section: its metrics, line color, and where a history record keeps its values. */
export const SOURCES = {
  android: {
    metrics: ANDROID_METRICS,
    color: 'var(--perf-chart-android)',
    values: (record) =>
      record.android
        ? { ...record.android, machineReference: record.androidReference ?? null }
        : null,
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
    adjustRows: addMachineFactors,
    adjustedCaption:
      'Medians per job. Each metric is adjusted by how WatermelonDB 0.28, which never changes, did on the same workload in the same job: NitromelonDB’s speedup over WatermelonDB (runs side by side) applied to WatermelonDB’s usual value, as if every job had a machine on which WatermelonDB measured its usual. So WatermelonDB’s dashed line is flat. The last chart shows how fast each job’s machine was.',
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
 * The adjusters get each record's values (SOURCES[source].values) alongside the rows.
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
