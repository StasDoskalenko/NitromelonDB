import { NativeModules } from 'react-native'

export type WMDatabaseBridge = {
  getRandomBytes?: (size: number) => number[]
  getRandomIds?: () => string
}

export const wmDatabaseBridge = NativeModules.WMDatabaseBridge as WMDatabaseBridge | undefined
