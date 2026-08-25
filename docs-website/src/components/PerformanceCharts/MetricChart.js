import clsx from 'clsx'
import React, { useMemo } from 'react'
import styles from './styles.module.css'

const WIDTH = 640
const HEIGHT = 220
const PADDING = { top: 16, right: 16, bottom: 12, left: 40 }

function buildPath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

function seriesForPlatform(history, platform, metric) {
  return history
    .map((record, index) => {
      const value = record[platform]?.[metric]?.avg
      return value == null ? null : { index, value, sha: record.sha ?? String(index) }
    })
    .filter(Boolean)
}

/** One metric (e.g. "cpu"), two series (Android/iOS), plotted as a hand-rolled inline SVG line chart. */
export function MetricChart({ history, metric, label, unit }) {
  const android = useMemo(() => seriesForPlatform(history, 'android', metric), [history, metric])
  const ios = useMemo(() => seriesForPlatform(history, 'ios', metric), [history, metric])

  const allValues = [...android, ...ios].map((p) => p.value)
  if (allValues.length === 0) {
    return (
      <div className={styles.chartCard}>
        <h3>{label}</h3>
        <p className={styles.empty}>No data yet.</p>
      </div>
    )
  }

  const maxIndex = Math.max(history.length - 1, 1)
  const minValue = Math.min(0, ...allValues)
  const maxValue = Math.max(...allValues) * 1.1 || 1
  const valueRange = maxValue - minValue || 1

  const plotWidth = WIDTH - PADDING.left - PADDING.right
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom

  const scaleX = (index) => PADDING.left + (index / maxIndex) * plotWidth
  const scaleY = (value) => PADDING.top + plotHeight - ((value - minValue) / valueRange) * plotHeight

  const toPoints = (series) => series.map((p) => ({ ...p, x: scaleX(p.index), y: scaleY(p.value) }))
  const androidPoints = toPoints(android)
  const iosPoints = toPoints(ios)

  return (
    <div className={styles.chartCard}>
      <h3>
        {label} <span className={styles.unit}>({unit})</span>
      </h3>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label} over time, Android and iOS`}
        className={styles.svg}
      >
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
        {androidPoints.length > 0 && <path d={buildPath(androidPoints)} className={styles.lineAndroid} fill="none" />}
        {iosPoints.length > 0 && <path d={buildPath(iosPoints)} className={styles.lineIos} fill="none" />}
        {androidPoints.map((p) => (
          <circle key={`a-${p.sha}`} cx={p.x} cy={p.y} r={2.5} className={styles.dotAndroid}>
            <title>{`Android · ${p.sha.slice(0, 7)} · ${p.value}${unit}`}</title>
          </circle>
        ))}
        {iosPoints.map((p) => (
          <circle key={`i-${p.sha}`} cx={p.x} cy={p.y} r={2.5} className={styles.dotIos}>
            <title>{`iOS · ${p.sha.slice(0, 7)} · ${p.value}${unit}`}</title>
          </circle>
        ))}
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={clsx(styles.swatch, styles.swatchAndroid)} /> Android
        </span>
        <span className={styles.legendItem}>
          <span className={clsx(styles.swatch, styles.swatchIos)} /> iOS
        </span>
      </div>
    </div>
  )
}
