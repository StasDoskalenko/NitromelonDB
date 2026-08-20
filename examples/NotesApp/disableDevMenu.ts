import { requireOptionalNativeModule } from 'expo'

// Hide the Expo dev client overlay before UI mounts. Maestro cannot tap through it.
try {
  const DevMenuPreferences = requireOptionalNativeModule('DevMenuPreferences')
  void DevMenuPreferences?.setPreferencesAsync({
    showsAtLaunch: false,
    showFloatingActionButton: false,
    isOnboardingFinished: true,
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
