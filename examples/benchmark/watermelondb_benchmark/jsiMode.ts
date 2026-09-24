// WatermelonDB's SQLiteAdapter can run through JSI (synchronous) or through the classic async
// bridge (`jsi: false`), which many apps still use. Pick at build time:
//   EXPO_PUBLIC_WM_JSI=false npx expo run:ios --configuration Release
// Expo inlines EXPO_PUBLIC_* variables into the bundle, so each build is one mode.
// Metro's transform cache ($TMPDIR/metro-cache) is not keyed on the variable, so when switching
// modes, clear it first (rm -rf "$TMPDIR/metro-cache") and check the engine label on screen
// ("WatermelonDB SQLite (JSI)" vs "(asynchronous)") -- otherwise the old mode is silently reused.
// Written literally as process.env.EXPO_PUBLIC_* -- that's the form Expo inlines
declare const process: { env: Record<string, string | undefined> }

export const USE_JSI = process.env.EXPO_PUBLIC_WM_JSI !== 'false'
