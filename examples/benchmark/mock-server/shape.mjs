// Table shapes for the Realistic sync card, shared by the mock server and (via the generated
// ../shared/realisticSyncShape.json) both benchmark apps. Deterministic: same TABLE_COUNT, same
// schema. Run `node mock-server/shape.mjs` after changing it to regenerate the JSON.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const TABLE_COUNT = 80

const TYPES = ['string', 'number', 'string', 'boolean', 'number', 'string']

// 4 to 23 columns per table, mixed types; every third table has an indexed foreign key
export function tableShapes() {
  return Array.from({ length: TABLE_COUNT }, (_, t) => {
    const count = 4 + ((t * 7) % 20)
    const columns = Array.from({ length: count }, (__, c) => ({
      name: c === 0 ? 'parent_id' : `c${c}`,
      type: c === 0 ? 'string' : TYPES[(t + c) % TYPES.length],
      ...(c === 0 && t % 3 === 0 ? { isIndexed: true } : {}),
    }))
    return { name: `rt_${t}`, columns }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../shared/realisticSyncShape.json',
  )
  writeFileSync(out, `${JSON.stringify({ tables: tableShapes() }, null, 2)}\n`)
  console.log(`wrote ${out}`)
}
