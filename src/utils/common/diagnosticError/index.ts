export type WatermelonError = Error & { framesToPop: number }

export type DiagnosticErrorFunction = (errorMessage: string) => Error

let customDiagnosticErrorFunction: DiagnosticErrorFunction | null | undefined = null

// Use this to replace default diagnosticError function to inject your custom logic
// (e.g. only display errors in development, or log errors to external service)
export function useCustomDiagnosticErrorFunction(
  diagnosticErrorFunction: DiagnosticErrorFunction,
): void {
  customDiagnosticErrorFunction = diagnosticErrorFunction
}

function asWatermelonError(error: Error): WatermelonError {
  const next = error as WatermelonError
  if (typeof next.framesToPop !== 'number') {
    next.framesToPop = 0
  }
  return next
}

export default function diagnosticError(errorMessage: string): WatermelonError {
  if (customDiagnosticErrorFunction) {
    return asWatermelonError(customDiagnosticErrorFunction(errorMessage))
  }

  const error = asWatermelonError(new Error(errorMessage))
  // hides `diagnosticError` from RN stack trace
  error.framesToPop = 1
  error.name = 'Diagnostic error'
  return error
}
