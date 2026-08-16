/* eslint-disable global-require */

import nativeRandomId_fallback from './fallback'
import logger from '../logger'
import type { Nitromelon } from '../../../nitro/Nitromelon.nitro'

let randomIds: string[] = []
let cur = 9999
let cachedNitromelon: Nitromelon | null | undefined

function nitromelonOrNull(): Nitromelon | null {
  if (cachedNitromelon !== undefined) {
    return cachedNitromelon
  }

  try {
    // `/index` is required: Metro prefers package-root `nitro.json` over `nitro/index.js`.
    const nitroModule = require('../../../nitro/index') as { nitromelon: Nitromelon }
    if (typeof nitroModule.nitromelon?.getRandomIds !== 'function') {
      cachedNitromelon = null
      return null
    }
    cachedNitromelon = nitroModule.nitromelon
    return cachedNitromelon
  } catch (error) {
    logger.warn('[SQLite] Failed to load Nitromelon for native random IDs; using JS fallback.', error)
    cachedNitromelon = null
    return null
  }
}

// NOTE: This is 2x faster than Math.random on iOS (6x faster than the old getRandomBytes path)
export default function nativeRandomId(): string {
  if (cur >= 64) {
    const ids = nitromelonOrNull()?.getRandomIds()
    if (!ids) {
      return nativeRandomId_fallback()
    }
    randomIds = ids.split(',')
    cur = 0
  }

  return randomIds[cur++]
}
