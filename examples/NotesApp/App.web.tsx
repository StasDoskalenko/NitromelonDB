import { lazy, Suspense } from 'react'
import { Platform } from 'react-native'
import App from './src/App'

const WebAdapterTestScreen = lazy(() => import('./src/screens/WebAdapterTestScreen'))

export default function WebApp() {
  const search = globalThis.location?.search ?? ''
  const isWebAdapterTest =
    Platform.OS === 'web' && new URLSearchParams(search).has('adapter-tests')

  return isWebAdapterTest ? (
    <Suspense fallback={null}>
      <WebAdapterTestScreen />
    </Suspense>
  ) : (
    <App />
  )
}
