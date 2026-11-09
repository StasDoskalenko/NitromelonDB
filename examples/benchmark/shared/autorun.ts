import { Platform, Settings } from 'react-native'

// Scripted runs without UI automation (scripts/run-sync-trials.mjs --driver launch, the default on
// iOS). The runner launches the app with
//   xcrun simctl launch <device> <app> -benchAutorun 'card=sync&size=50000&report=http%3A%2F%2F…'
// iOS puts `-key value` launch arguments into NSUserDefaults, which Settings reads. The app opens
// that card, runs it once at that size, and POSTs the result to `report`. A run then costs the
// app launch plus the benchmark, instead of a Maestro flow (a JVM start, the iOS test driver, and
// UI timeouts): ~2.5 minutes per run on a CI runner.
// Query-string format rather than JSON: NSUserDefaults parses a launch argument that looks like a
// property list (`{…}`) as one.

export type AutorunCard = 'stress' | 'sync' | 'incr' | 'real'

export type Autorun = {
  card: AutorunCard
  size: number
  report: string
}

/** What a card gets when it's the one to autorun. */
export type AutorunProps = {
  size: number
  // Resolves once the runner has noted the start (it reads the app's CPU time then, so the
  // benchmark's CPU time doesn't include launching the app); run the card after it
  ready: () => Promise<void>
  onResult: (result: unknown) => void
  onError: (message: string) => void
}

const CARDS: AutorunCard[] = ['stress', 'sync', 'incr', 'real']

function parse(raw: unknown): Autorun | null {
  if (typeof raw !== 'string') {
    return null
  }
  const params: Record<string, string> = {}
  for (const pair of raw.split('&')) {
    const at = pair.indexOf('=')
    if (at > 0) {
      params[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1))
    }
  }
  const card = params.card as AutorunCard
  const size = Number(params.size)
  if (!CARDS.includes(card) || !Number.isFinite(size) || !params.report) {
    return null
  }
  return { card, size, report: params.report }
}

// Read once at startup: launch arguments only apply to this launch
export const AUTORUN: Autorun | null =
  Platform.OS === 'ios' ? parse(Settings.get('benchAutorun')) : null

async function report(payload: Record<string, unknown>): Promise<void> {
  if (!AUTORUN) {
    return
  }
  try {
    await fetch(AUTORUN.report, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card: AUTORUN.card, size: AUTORUN.size, ...payload }),
    })
  } catch {
    // The runner times out and reports the run as failed
  }
}

/**
 * Props for `card` when it's the one this launch should run, else undefined. `engine` goes into
 * every report, so the runner can check which adapter actually ran (WatermelonDB silently falls
 * back from JSI to the bridge adapter).
 */
export function autorunFor(card: AutorunCard, engine: string | null): AutorunProps | undefined {
  if (AUTORUN?.card !== card) {
    return undefined
  }
  return {
    size: AUTORUN.size,
    ready: () => report({ event: 'start' }),
    onResult: (result) => void report({ engine, result }),
    onError: (message) => void report({ engine, error: message }),
  }
}
