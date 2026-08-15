export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '0.0s'
  }
  if (ms < 10_000) {
    return `${(ms / 1000).toFixed(2)}s`
  }
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  if (minutes === 0) {
    return `${seconds.toFixed(1)}s`
  }
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  if (hours === 0) {
    return `${remainMinutes}m ${seconds.toFixed(1)}s`
  }
  return `${hours}h ${remainMinutes}m ${seconds.toFixed(0)}s`
}

export function formatOps(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '—'
  }
  return `${formatNumber(value)}/s`
}

export function phaseLabel(phase: string): string {
  switch (phase) {
    case 'reset':
      return 'Resetting database'
    case 'write':
      return 'Writing records'
    case 'query':
      return 'Running queries'
    case 'delete':
      return 'Deleting records'
    case 'done':
      return 'Finished'
    case 'error':
      return 'Failed'
    default:
      return 'Ready'
  }
}
