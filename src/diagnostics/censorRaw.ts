import { mapObj } from '../utils/fp'
import type { DirtyRaw } from '../RawRecord'

// beginning, end, length
export const censorValue = (value: string): string =>
  `${value.slice(0, 2)}***${value.slice(-2)}(${value.length})`

const shouldCensorKey = (key: string): boolean =>
  key !== 'id' && !key.endsWith('_id') && key !== '_status' && key !== '_changed'

const censorRaw = mapObj((value: unknown, key: string) =>
  shouldCensorKey(key) && typeof value === 'string' ? censorValue(value) : value,
) as (raw: DirtyRaw) => DirtyRaw

export default censorRaw
