import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Screens pad by these instead of a fixed status-bar guess: iPhone Duo's inner
// display (and iOS 27 resizable windows generally) can report non-zero
// left/right insets and a different top inset than a regular iPhone.
// .windows.ts sibling returns zeros — no safe areas there, and Windows' Metro
// can't resolve react-native-safe-area-context from this app's node_modules.
export function useScreenInsets() {
  return useSafeAreaInsets()
}
