import { NitroModules } from 'react-native-nitro-modules'
import type { Nitromelon, NitromelonDatabase } from './Nitromelon.nitro'

export const nitromelon = NitroModules.createHybridObject<Nitromelon>('Nitromelon')
export type { Nitromelon, NitromelonDatabase }
