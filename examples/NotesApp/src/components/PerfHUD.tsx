import { Pressable, Text, View } from 'react-native'
import { usePerformanceRecorder } from '../hooks/usePerformanceRecorder'

const hiddenText = { color: 'transparent' } as const

/**
 * Always-mounted controls that let a Maestro flow start/stop a CPU/memory/FPS
 * recording and read back a JSON summary via `copyTextFrom`. On-screen,
 * below the status bar, with a real 44x44 touch target -- and, critically,
 * fully opaque (not hidden via the container's own opacity). Each deviation
 * from that broke something, in order:
 *   - opacity: 0 (or top: 0, inside the status bar's own touch zone) drops
 *     the view from iOS's accessibility tree entirely, so Maestro can't
 *     find it.
 *   - opacity exactly 0.01 IS found and "tapped", but onPress never fires --
 *     UIKit's default hitTest excludes views with alpha < 0.01, and 0.01
 *     lands right on that cutoff (float rounding pushes it under). 0.02
 *     clears the touch-delivery cutoff, but the text was still plainly
 *     legible on screen (confirmed via screenshot) -- 2% opacity dark text
 *     on a light background reads fine, it isn't imperceptible.
 *   - a bare <Text> needs `accessible` for its content to be exposed at all
 *     (copyTextFrom otherwise always reads empty, regardless of what's
 *     actually rendered) -- see perf-summary-json below.
 * The fix that's actually invisible AND tappable: keep the view at full
 * opacity (touch delivery is never in question) and make the *text* itself
 * transparent instead, via `color: 'transparent'` on each Text -- nothing
 * to see, nothing ambiguous about hit-testing.
 * See maestro/perf-run.yaml and scripts/extract-perf-result.mjs.
 */
export function PerfHUD() {
  const { start, stop, summary } = usePerformanceRecorder()

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 60, left: 0 }}>
      <Pressable
        testID="perf-start-button"
        nativeID="perf-start-button"
        onPress={start}
        hitSlop={12}
        style={{ minWidth: 44, minHeight: 44 }}
        accessibilityRole="button"
      >
        <Text style={hiddenText}>start</Text>
      </Pressable>
      <Pressable
        testID="perf-stop-button"
        nativeID="perf-stop-button"
        onPress={stop}
        hitSlop={12}
        style={{ minWidth: 44, minHeight: 44 }}
        accessibilityRole="button"
      >
        <Text style={hiddenText}>stop</Text>
      </Pressable>
      <Text testID="perf-summary-json" nativeID="perf-summary-json" accessible style={hiddenText}>
        {summary != null ? JSON.stringify(summary) : 'pending'}
      </Text>
    </View>
  )
}
