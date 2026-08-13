import diagnosticError from '../diagnosticError'

// If `condition` is falsy, throws an Error with the passed message
export default function invariant(condition: unknown, errorMessage?: string): asserts condition {
  if (!condition) {
    const error = diagnosticError(errorMessage || 'Broken invariant')
    error.framesToPop += 1
    throw error
  }
}
