import React, { useMemo } from 'react'
import styles from './styles.module.css'

const WIDTH = 640
const HEIGHT = 220
const PADDING = { top: 16, right: 16, bottom: 12, left: 40 }

function buildPath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

function seriesFor(history, metric) {
  return history
    .map((record, index) => {
      const value = record.android?.[metric]
      return value == null ? null : { index, value, sha: record.sha ?? String(index) }
    })
    .filter(Boolean)
}

/** One metric (e.g. "cpu"), Android only, plotted as a hand-rolled inline SVG line chart. */
export function MetricChart({ history, metric, label, unit }) {
  const points = useMemo(() => seriesFor(history, metric), [history, metric])

  if (points.length === 0) {
    return (
      <div className={styles.chartCard}>
        <h3>{label}</h3>
        <p className={styles.empty}>No data yet.</p>
      </div>
    )
  }

  const values = points.map((p) => p.value)
  const maxIndex = Math.max(history.length - 1, 1)
  const minValue = Math.min(0, ...values)
  const maxValue = Math.max(...values) * 1.1 || 1
  const valueRange = maxValue - minValue || 1

  const plotWidth = WIDTH - PADDING.left - PADDING.right
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom

  const scaleX = (index) => PADDING.left + (index / maxIndex) * plotWidth
  const scaleY = (value) => PADDING.top + plotHeight - ((value - minValue) / valueRange) * plotHeight

  const plotted = points.map((p) => ({ ...p, x: scaleX(p.index), y: scaleY(p.value) }))

  return (
    <div className={styles.chartCard}>
      <h3>
        {label} <span className={styles.unit}>({unit})</span>
      </h3>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${label} over time`} className={styles.svg}>
        <line
          x1={PADDING.left}
          y1={PADDING.top + plotHeight}
          x2={WIDTH - PADDING.right}
          y2={PADDING.top + plotHeight}
          className={styles.axis}
        />
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={PADDING.top + plotHeight}
          className={styles.axis}
        />
        <text x={PADDING.left - 6} y={PADDING.top + 4} textAnchor="end" className={styles.axisLabel}>
          {Math.round(maxValue)}
        </text>
        <text x={PADDING.left - 6} y={PADDING.top + plotHeight} textAnchor="end" className={styles.axisLabel}>
          {Math.round(minValue)}
        </text>
        <path d={buildPath(plotted)} className={styles.lineAndroid} fill="none" />
        {plotted.map((p) => (
          <circle key={p.sha} cx={p.x} cy={p.y} r={2.5} className={styles.dotAndroid}>
            <title>{`${p.sha.slice(0, 7)} · ${p.value}${unit}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}
