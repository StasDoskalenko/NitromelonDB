import logger from '../logger'

type Callback = () => void;
const lowMemoryCallbacks: Callback[] = [];
export function onLowMemory(callback: Callback): void {
  lowMemoryCallbacks.push(callback);
}
// Called from the native memory-pressure signal (iOS didReceiveMemoryWarning,
// Android onTrimMemory filtered to critical levels) via each SQLite adapter's
// onMemoryWarning callback -- see makeDispatcher/index.native.ts.
export function _triggerOnLowMemory(): void {
  logger.debug(`[Memory] Low memory signal received, notifying ${lowMemoryCallbacks.length} listener(s)`)
  lowMemoryCallbacks.forEach(callback => callback());
}
