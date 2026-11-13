/**
 * Adjusts flashlight results for the CI machine's speed, the way the iOS charts use WatermelonDB
 * 0.28 (docs-website/src/components/PerformanceCharts/metrics.js, which repeats this for the charts).
 *
 * The flashlight job measures a fixed reference build (scripts/ci-notesapp-android-reference.sh)
 * alternately with the commit's own build, on the same emulator. The reference never changes, so how
 * its CPU, FPS and score compare with their medians over master's history says how slow that job's
 * machine was, per metric: 1.1 = the reference used 1.1× its usual CPU (or got 1/1.1 of its usual
 * FPS / score). The commit's values are divided by it (FPS and score multiplied), as if the job had
 * a machine of median speed. Each metric gets its own factor, because a slow machine moves CPU a
 * lot more than FPS (CPU swings ±15% on master's runs, FPS ±3%). RAM doesn't depend on the
 * machine's speed and isn't adjusted. Only runs measured with the same reference tag are compared.
 */

export const ADJUSTED_METRICS = [
  { key: 'score', better: 'higher' },
  { key: 'cpu', better: 'lower' },
  { key: 'fps', better: 'higher' },
]

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** The reference's median per adjusted metric over `records` measured with `tag`, and how many. */
export function referenceMedians(records, tag) {
  const references = records
    .map((record) => record?.androidReference)
    .filter((reference) => reference && reference.reference === tag)
  const medians = Object.fromEntries(
    ADJUSTED_METRICS.map(({ key }) => {
      const values = references.map((reference) => reference[key]).filter(positive)
      return [key, values.length ? median(values) : null]
    }),
  )
  return { medians, runs: references.length }
}

/** This job's machine factor per adjusted metric (> 1: slower than usual), or null without data. */
export function machineFactors(reference, medians) {
  if (!reference) return null
  const factors = {}
  for (const { key, better } of ADJUSTED_METRICS) {
    if (!positive(reference[key]) || !positive(medians?.[key])) return null
    factors[key] = better === 'lower' ? reference[key] / medians[key] : medians[key] / reference[key]
  }
  return factors
}

/** A flashlight summary as if measured on a machine of median speed. */
export function adjust(summary, factors) {
  const adjusted = { ...summary }
  for (const { key, better } of ADJUSTED_METRICS) {
    const value = summary[key]
    if (typeof value !== 'number') continue
    adjusted[key] = better === 'lower' ? value / factors[key] : value * factors[key]
  }
  if (typeof adjusted.score === 'number') adjusted.score = Math.min(100, adjusted.score)
  return adjusted
}
