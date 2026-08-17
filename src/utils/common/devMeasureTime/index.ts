const getPreciseTimeFunction: () => () => number = () => {
  if (typeof global !== 'undefined' && typeof global.nativePerformanceNow === 'function') {
    return global.nativePerformanceNow;
  } else if (
    typeof window !== 'undefined' &&
    window.performance &&
    typeof window.performance.now === 'function'
  ) {
    return window.performance.now.bind(window.performance);
  }

  // ts-expect-error -- migrated from Flow
  return Date.now;
};

const getPreciseTime: () => number = getPreciseTimeFunction();
export { getPreciseTime };
export function devMeasureTime<T>(executeBlock: () => T): [T, number] {
  const start = getPreciseTime();
  const result = executeBlock();
  const time = getPreciseTime() - start;
  return [result, time];
}
export async function devMeasureTimeAsync<T>(executeBlock: () => Promise<T>): Promise<[T, number]> {
  const start = getPreciseTime();
  const result = await executeBlock();
  const time = getPreciseTime() - start;
  return [result, time];
}
