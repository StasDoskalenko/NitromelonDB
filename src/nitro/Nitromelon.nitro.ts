import type { HybridObject } from 'react-native-nitro-modules'

export interface NitromelonDatabase extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  unsafeClose(): void
}

export interface Nitromelon extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly nativeEngine: string
  ping(): string
  createAdapter(dbName: string, usesExclusiveLocking: boolean): NitromelonDatabase
  provideSyncJson(id: number, json: string): void
}
