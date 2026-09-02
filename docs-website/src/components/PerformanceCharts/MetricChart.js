import React, { useId, useMemo } from 'react'
import styles from './styles.module.css'

// Rendered into a responsive container via viewBox; these are the internal
// coordinate units, not pixels. Wide + short reads well for a time series.
const WIDTH = 960
const HEIGHT = 300
const PADDING = { top: 24, right: 24, bottom: 40, left: 56 }

const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

function buildLinePath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
}

function seriesFor(history, metric) {
  return history
    .map((record) => {
      const value = record.android?.[metric]
      if (value == null) return null
      const t = Date.parse(record.date)
      return {
        value,
        time: Number.isNaN(t) ? null : t,
        sha: record.sha ?? '',
        prNumber: record.prNumber ?? null,
      }
    })
    .filter(Boolean)
}

/** A tight [min, max] domain around the data with ~12% head/foot room, plus a few round tick values. */
function niceScale(values) {
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const span = dataMax - dataMin
  const pad = span === 0 ? Math.max(1, Math.abs(dataMax) * 0.05) : span * 0.12
  let min = dataMin - pad
  let max = dataMax + pad
  // These metrics are never negative -- don't waste vertical space below zero.
  if (min < 0 && dataMin >= 0) min = 0

  const ticks = []
  const step = (max - min) / 4
  for (let i = 0; i <= 4; i++) ticks.push(min + step * i)
  // Enough decimals that adjacent ticks read as distinct values.
  const decimals = step >= 10 ? 0 : step >= 1 ? 1 : step >= 0.1 ? 2 : 3
  return { min, max, ticks, decimals }
}

/** One metric (e.g. "cpu"), Android only, plotted as a hand-rolled inline SVG line chart. */
export function MetricChart({ history, metric, label, unit }) {
  const gradientId = `perf-area-${useId().replace(/:/g, '')}`
  const points = useMemo(() => seriesFor(history, metric), [history, metric])

  if (points.length === 0) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.chartHead}>
          <h3>{label}</h3>
        </div>
        <p className={styles.empty}>No data yet.</p>
      </div>
    )
  }

  const values = points.map((p) => p.value)
  const { min, max, ticks, decimals } = niceScale(values)
  const valueRange = max - min || 1

  // Fall back to evenly-spaced points when timestamps are missing/degenerate.
  const times = points.map((p) => p.time)
  const haveTime = times.every((t) => t != null)
  const tMin = haveTime ? Math.min(...times) : 0
  const tMax = haveTime ? Math.max(...times) : points.length - 1
  const tRange = tMax - tMin || 1

  const plotWidth = WIDTH - PADDING.left - PADDING.right
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom

  const scaleX = (p, i) => PADDING.left + ((haveTime ? p.time - tMin : i) / tRange) * plotWidth
  const scaleY = (value) => PADDING.top + plotHeight - ((value - min) / valueRange) * plotHeight

  const plotted = points.map((p, i) => ({ ...p, x: scaleX(p, i), y: scaleY(p.value) }))
  const linePath = buildLinePath(plotted)
  const first = plotted[0]
  const last = plotted[plotted.length - 1]
  const areaPath = `${linePath} L ${last.x.toFixed(1)} ${(PADDING.top + plotHeight).toFixed(
    1
  )} L ${first.x.toFixed(1)} ${(PADDING.top + plotHeight).toFixed(1)} Z`

  const latest = points[points.length - 1]
  const previous = points.length > 1 ? points[points.length - 2] : null
  const delta = previous ? latest.value - previous.value : null

  const xLabelIndices = points.length <= 3 ? plotted.map((_, i) => i) : [0, Math.floor((plotted.length - 1) / 2), plotted.length - 1]

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHead}>
        <h3>
          {label} <span className={styles.unit}>({unit})</span>
        </h3>
        <div className={styles.latest}>
          <span className={styles.latestValue}>
            {latest.value}
            <span className={styles.latestUnit}>{unit}</span>
          </span>
          {delta != null && Math.abs(delta) >= 0.05 && (
            <span className={styles.delta}>
              {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} vs previous
            </span>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label} over ${points.length} runs`}
        className={styles.svg}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--perf-chart-android)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--perf-chart-android)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => {
          const y = scaleY(tick)
          return (
            <g key={tick}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={WIDTH - PADDING.right}
                y2={y}
                className={styles.gridline}
              />
              <text x={PADDING.left - 10} y={y + 4} textAnchor="end" className={styles.axisLabel}>
                {tick.toFixed(decimals)}
              </text>
            </g>
          )
        })}

        {xLabelIndices.map((i) => {
          const p = plotted[i]
          if (!p || p.time == null) return null
          const anchor = i === 0 ? 'start' : i === plotted.length - 1 ? 'end' : 'middle'
          return (
            <text
              key={`x-${i}`}
              x={p.x}
              y={PADDING.top + plotHeight + 24}
              textAnchor={anchor}
              className={styles.axisLabel}
            >
              {dateFmt.format(new Date(p.time))}
            </text>
          )
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} className={styles.lineAndroid} fill="none" />

        {plotted.map((p, i) => (
          <circle key={`${p.sha}-${i}`} cx={p.x} cy={p.y} r={3.5} className={styles.dotAndroid}>
            <title>
              {[
                p.time != null ? dateFmt.format(new Date(p.time)) : `run ${i + 1}`,
                p.sha ? p.sha.slice(0, 7) : null,
                p.prNumber ? `#${p.prNumber}` : null,
                `${p.value}${unit}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  )
}
