import React, { useId, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dateFmt, dateTimeFmt, describeDelta, formatValue } from './metrics'
import styles from './styles.module.css'

const SERIES = 'var(--perf-chart-android)'
const SURFACE = 'var(--ifm-background-surface-color)'
const AXIS_TICK = { fill: 'var(--ifm-color-emphasis-600)', fontSize: 12 }

/** ~5 evenly spaced run indices for date ticks (the x-axis is runs, not wall-clock time). */
function pickTicks(rows) {
  if (rows.length <= 5) return rows.map((r) => r.index)
  const ticks = []
  for (let i = 0; i < 5; i++) ticks.push(rows[Math.round((i * (rows.length - 1)) / 4)].index)
  return [...new Set(ticks)]
}

function RunTooltip({ active, payload, metric, previousByIndex, compact }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const value = row[metric.key]
  if (value == null) return null

  if (compact) {
    return (
      <div className={styles.tooltipCompact}>
        <strong>{formatValue(value)}</strong>
        <span className={styles.tooltipUnit}> {metric.unit}</span>
      </div>
    )
  }

  const delta = describeDelta(metric, value, previousByIndex.get(row.index)?.[metric.key])

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipValue}>
        <span className={styles.tooltipKey} aria-hidden="true" />
        <strong>{formatValue(value)}</strong>
        <span className={styles.tooltipUnit}>{metric.unit}</span>
        {delta && (
          <span className={styles.tooltipDelta} data-direction={delta.direction}>
            {delta.text} {delta.direction !== 'flat' ? `(${delta.direction})` : ''} vs previous run
          </span>
        )}
      </div>
      {row.subject && <div className={styles.tooltipSubject}>{row.subject}</div>}
      <div className={styles.tooltipMeta}>
        {[
          row.time != null ? dateTimeFmt.format(new Date(row.time)) : null,
          row.sha ? row.sha.slice(0, 7) : null,
          row.prNumber ? `#${row.prNumber}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div className={styles.tooltipHint}>Click to pin this run</div>
    </div>
  )
}

/**
 * One metric's history as a line + area wash. All cards share `syncId`, so hovering a
 * run in one chart shows the same run in every chart; clicking pins it (`onSelect`).
 */
export function MetricChart({ rows, metric, pinnedIndex, onSelect }) {
  const gradientId = `perf-area-${useId().replace(/:/g, '')}`
  // Only the chart under the pointer shows the full tooltip; synced ones show a value pill.
  const [hovered, setHovered] = useState(false)
  const points = useMemo(() => rows.filter((r) => r[metric.key] != null), [rows, metric.key])
  const ticks = useMemo(() => pickTicks(rows), [rows])
  const rowByIndex = useMemo(() => new Map(rows.map((r) => [r.index, r])), [rows])
  const previousByIndex = useMemo(() => {
    const map = new Map()
    for (let i = 1; i < points.length; i++) map.set(points[i].index, points[i - 1])
    return map
  }, [points])

  const header = (
    <h3>
      {metric.label} <span className={styles.unit}>({metric.unit})</span>
    </h3>
  )

  if (points.length === 0) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.chartHead}>{header}</div>
        <p className={styles.empty}>No data in this range.</p>
      </div>
    )
  }

  const latest = points[points.length - 1]
  const delta = describeDelta(
    metric,
    latest[metric.key],
    previousByIndex.get(latest.index)?.[metric.key],
  )

  const handleClick = (state) => {
    const label = state?.activeLabel
    const row = label != null ? rowByIndex.get(Number(label)) : rows[Number(state?.activeIndex)]
    if (row) onSelect(row.sha)
  }

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHead}>
        {header}
        <div className={styles.latest}>
          <span className={styles.latestValue}>
            {formatValue(latest[metric.key])}
            <span className={styles.latestUnit}>{metric.unit}</span>
          </span>
          {delta && delta.direction !== 'flat' && (
            <span className={styles.delta} data-direction={delta.direction}>
              {delta.text} ({delta.direction}) vs previous
            </span>
          )}
        </div>
      </div>

      <div
        className={styles.plot}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart
            data={rows}
            syncId="perf"
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={handleClick}
            style={{ cursor: 'pointer' }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
                <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--ifm-color-emphasis-200)" />
            <XAxis
              dataKey="index"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={ticks}
              tickFormatter={(i) => {
                const t = rowByIndex.get(i)?.time
                return t != null ? dateFmt.format(new Date(t)) : ''
              }}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--ifm-color-emphasis-300)' }}
              padding={{ left: 6, right: 6 }}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickCount={5}
              width={44}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatValue}
            />
            <Tooltip
              cursor={{ stroke: 'var(--ifm-color-emphasis-500)', strokeWidth: 1 }}
              content={
                <RunTooltip metric={metric} previousByIndex={previousByIndex} compact={!hovered} />
              }
              position={hovered ? undefined : { y: 0 }}
              wrapperStyle={{ pointerEvents: 'none' }}
              isAnimationActive={false}
            />
            {pinnedIndex != null && (
              <ReferenceLine
                x={pinnedIndex}
                stroke="var(--ifm-color-emphasis-700)"
                strokeDasharray="4 3"
              />
            )}
            <Area
              dataKey={metric.key}
              type="linear"
              stroke="none"
              fill={`url(#${gradientId})`}
              connectNulls
              isAnimationActive={false}
              activeDot={false}
              tooltipType="none"
            />
            <Line
              dataKey={metric.key}
              name={metric.label}
              type="linear"
              stroke={SERIES}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 5, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
