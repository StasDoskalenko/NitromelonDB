import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { StyleSheet, View, type ViewProps } from 'react-native'

// Only true for iOS 26+ builds made with the iOS 26+ SDK; Android and web get
// the plain View with the caller's fill and hairline unchanged.
const liquidGlass = isLiquidGlassAvailable()

// A bar (pager, composer) rendered as Liquid Glass where the OS supports it.
// .windows.tsx sibling is a plain View — Windows' Metro can't resolve
// expo-glass-effect from this app's node_modules.
export function GlassSurface({ style, ...props }: ViewProps) {
  if (!liquidGlass) {
    return <View style={style} {...props} />
  }
  return <GlassView glassEffectStyle="regular" style={[style, styles.glass]} {...props} />
}

const styles = StyleSheet.create({
  // The glass material supplies its own fill and edge.
  glass: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
})
