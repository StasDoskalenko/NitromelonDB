// Compressed records have this syntax:
// [
//   ['id', 'body', ...], // 0: column names
//   ['foo', 'bar', ...], // values matching column names
//   'id',                // only cached id
// ]
export default function decodeQueryResult(
  compressedRecords: unknown[],
): Array<string | Record<string, unknown>> {
  const len = compressedRecords.length
  if (!len) {
    return []
  }
  const columnNames = compressedRecords[0] as unknown[]
  const columnsLen = columnNames.length

  const rawRecords = new Array<string | Record<string, unknown>>(len - 1)
  let rawRecord: string | Record<string, unknown>
  let compressedRecord: unknown
  for (let i = 1; i < len; i++) {
    compressedRecord = compressedRecords[i]
    if (typeof compressedRecord === 'string') {
      rawRecord = compressedRecord
    } else {
      const values = compressedRecord as unknown[]
      rawRecord = {}
      for (let j = 0; j < columnsLen; j++) {
        rawRecord[columnNames[j] as string] = values[j]
      }
    }
    rawRecords[i - 1] = rawRecord
  }
  return rawRecords
}
