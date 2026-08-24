import type { PropsWithChildren } from 'react'
import { KeyboardStickyView } from 'react-native-keyboard-controller'

// .windows.tsx sibling swaps this for a plain View — react-native-keyboard-controller
// has no Windows support (no on-screen keyboard to control there), and Windows'
// Metro config can't resolve it anyway (it only looks in its own node_modules
// and the workspace root, not examples/NotesApp/node_modules).
export function ComposerDock({ children }: PropsWithChildren) {
  return <KeyboardStickyView>{children}</KeyboardStickyView>
}
