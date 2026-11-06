/** The flashlight metrics we chart, in display order. `better` drives the delta wording. */
export const METRICS = [
  { key: 'score', label: 'Flashlight score', unit: '/100', better: 'higher' },
  { key: 'cpu', label: 'CPU usage', unit: '%', better: 'lower' },
  { key: 'ram', label: 'RAM usage', unit: 'MB', better: 'lower' },
  { key: 'fps', label: 'FPS', unit: 'fps', better: 'higher' },
]

export const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
export const dateTimeFmt = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Number formatting for values and deltas: integers stay integers, the rest get one decimal. */
export function formatValue(value) {
  if (value == null) return '–'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * The change from `previous` to `current` for a metric: signed magnitude plus whether
 * it moved the good way. Changes below 0.05 count as flat (flashlight rounds to 0.1).
 */
export function describeDelta(metric, current, previous) {
  if (current == null || previous == null) return null
  const delta = current - previous
  if (Math.abs(delta) < 0.05) return { delta: 0, text: 'no change', direction: 'flat' }
  const improved = metric.better === 'lower' ? delta < 0 : delta > 0
  return {
    delta,
    text: `${delta > 0 ? '+' : '−'}${formatValue(Math.abs(delta))}`,
    direction: improved ? 'better' : 'worse',
  }
}

/** History records → chart rows: one row per run, every metric on the same row so charts share an index. */
export function toRows(history) {
  return history
    .filter((record) => record.android != null)
    .map((record, index) => {
      const time = Date.parse(record.date)
      const row = {
        index,
        time: Number.isNaN(time) ? null : time,
        sha: record.sha ?? '',
        prNumber: record.prNumber ?? null,
        subject: record.subject ?? null,
      }
      for (const metric of METRICS) row[metric.key] = record.android[metric.key] ?? null
      return row
    })
}
