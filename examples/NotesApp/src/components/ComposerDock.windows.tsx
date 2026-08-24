import type { PropsWithChildren } from 'react'
import { View } from 'react-native'

// No on-screen keyboard to dock above on Windows — see ComposerDock.tsx.
export function ComposerDock({ children }: PropsWithChildren) {
  return <View>{children}</View>
}
