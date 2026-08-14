import type { HybridObject } from 'react-native-nitro-modules'

export interface Nitromelon extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly nativeEngine: string
  ping(): string
}
