import { requireOptionalNativeModule } from 'expo'

// Disable Expo Dev Menu by default (Maestro cannot tap through overlays / FAB).
try {
  const DevMenuPreferences = requireOptionalNativeModule('DevMenuPreferences')
  void DevMenuPreferences?.setPreferencesAsync({
    showsAtLaunch: false,
    showFloatingActionButton: false,
    isOnboardingFinished: true,
    motionGestureEnabled: false,
    touchGestureEnabled: false,
    keyCommandsEnabled: false,
  })
} catch {
  // Native module missing in some environments (web / tests).
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DevClient = require('expo-dev-client') as typeof import('expo-dev-client')
  DevClient.hideMenu()
  DevClient.closeMenu()
} catch {
  // expo-dev-client is native-only.
}
