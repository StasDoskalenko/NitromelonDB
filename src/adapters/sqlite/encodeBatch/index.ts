import type { RecordId } from '../../../Model'
import type { TableName, TableSchema, AppSchema } from '../../../Schema'
import type { RawRecord } from '../../../RawRecord'
import type { BatchOperation } from '../../type'
import { validateTable } from '../../common'
import type { SQL, SQLiteArg, NativeBridgeBatchOperation } from '../type'

export function encodeInsertSql(schema: TableSchema): SQL {
  const columns = schema.columnArray
  const columnsSql = `"id", "_status", "_changed${columns
    .map((column) => `", "${column.name}`)
    .join('')}"`
  const placeholders = Array(columns.length + 3)
    .fill('?')
    .join(', ')
  return `insert into "${schema.name}" (${columnsSql}) values (${placeholders})`
}

export function encodeInsertArgs(tableSchema: TableSchema, raw: RawRecord): SQLiteArg[] {
  const columns = tableSchema.columnArray
  const len = columns.length

  const args: SQLiteArg[] = Array(len + 3)
  args[0] = raw.id
  args[1] = raw._status
  args[2] = raw._changed
  for (let i = 0; i < len; i++) {
    args[i + 3] = raw[columns[i].name] as SQLiteArg
  }

  return args
}

export function encodeUpdateSql(schema: TableSchema): SQL {
  const columns = schema.columnArray
  const placeholders = columns.map((column) => `, "${column.name}" = ?`).join('')
  return `update "${schema.name}" set "_status" = ?, "_changed" = ?${placeholders} where "id" is ?`
}

export function encodeUpdateArgs(tableSchema: TableSchema, raw: RawRecord): SQLiteArg[] {
  const columns = tableSchema.columnArray
  const len = columns.length

  const args: SQLiteArg[] = Array(len + 3)
  args[0] = raw._status
  args[1] = raw._changed
  for (let i = 0; i < len; i++) {
    args[i + 2] = raw[columns[i].name] as SQLiteArg
  }
  args[len + 2] = raw.id

  return args
}

type GroupedBatchOperation = [
  BatchOperation[0],
  TableName,
  Array<RawRecord | RecordId>,
]

const REMOVE_FROM_CACHE = -1
const IGNORE_CACHE = 0
const ADD_TO_CACHE = 1

export function groupOperations(operations: BatchOperation[]): GroupedBatchOperation[] {
  const grouppedOperations: GroupedBatchOperation[] = []
  let previousType: string | null = null
  let previousTable: TableName | null = null
  let currentOperation: GroupedBatchOperation | null = null
  operations.forEach((operation) => {
    const [type, table, rawOrId] = operation
    if (type !== previousType || table !== previousTable) {
      if (currentOperation) {
        grouppedOperations.push(currentOperation)
      }
      previousType = type
      previousTable = table
      currentOperation = [type, table, []]
    }

    if (!currentOperation) {
      currentOperation = [type, table, []]
    }
    currentOperation[2].push(rawOrId)
  })
  if (currentOperation) {
    grouppedOperations.push(currentOperation)
  }
  return grouppedOperations
}

function withRecreatedIndices(
  operations: NativeBridgeBatchOperation[],
  schema: AppSchema,
): NativeBridgeBatchOperation[] {
  const { encodeDropIndices, encodeCreateIndices } = require('../encodeSchema') as {
    encodeDropIndices: (schema: AppSchema) => SQL
    encodeCreateIndices: (schema: AppSchema) => SQL
  }
  const toEncodedOperations = (sqlStr: SQL): NativeBridgeBatchOperation[] =>
    sqlStr
      .split(';') // TODO: This will break when FTS is merged
      .filter((sql) => sql)
      .map((sql) => [0, null, sql, [[]]])
  operations.unshift(...toEncodedOperations(encodeDropIndices(schema)))
  operations.push(...toEncodedOperations(encodeCreateIndices(schema)))
  return operations
}

export default function encodeBatch(
  operations: BatchOperation[],
  schema: AppSchema,
): NativeBridgeBatchOperation[] {
  const nativeOperations = groupOperations(operations).map(([type, table, recordsOrIds]) => {
    validateTable(table, schema)

    switch (type) {
      case 'create':
        return [
          ADD_TO_CACHE,
          table,
          encodeInsertSql(schema.tables[table]),
          recordsOrIds.map((raw) => encodeInsertArgs(schema.tables[table], raw as RawRecord)),
        ] as NativeBridgeBatchOperation
      case 'update':
        return [
          IGNORE_CACHE,
          null,
          encodeUpdateSql(schema.tables[table]),
          recordsOrIds.map((raw) => encodeUpdateArgs(schema.tables[table], raw as RawRecord)),
        ] as NativeBridgeBatchOperation
      case 'markAsDeleted':
        return [
          REMOVE_FROM_CACHE,
          table,
          `update "${table}" set "_status" = 'deleted' where "id" == ?`,
          recordsOrIds.map((id) => [id as RecordId]),
        ] as NativeBridgeBatchOperation
      case 'destroyPermanently':
        return [
          REMOVE_FROM_CACHE,
          table,
          `delete from "${table}" where "id" == ?`,
          recordsOrIds.map((id) => [id as RecordId]),
        ] as NativeBridgeBatchOperation
      default:
        throw new Error('unknown batch operation type')
    }
  })

  // For large batches, it's profitable to delete all indices and then recreate them
  if (operations.length >= 1000) {
    return withRecreatedIndices(nativeOperations, schema)
  }
  return nativeOperations
}
