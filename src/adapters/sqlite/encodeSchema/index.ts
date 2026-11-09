import type {
  TableSchema,
  AppSchema,
  ColumnSchema,
  TableName,
  AppSchemaUnsafeSqlKind,
} from '../../../Schema'
import { nullValue } from '../../../RawRecord'
import type { MigrationStep, AddColumnsMigrationStep } from '../../../Schema/migrations'
import type { SQL } from '../type'

import encodeValue from '../encodeValue'

const standardColumns = `"id" primary key, "_changed", "_status"`
const commonSchema =
  'create table "local_storage" ("key" varchar(16) primary key not null, "value" text not null);' +
  'create index "local_storage_key_index" on "local_storage" ("key");'

export type EncodeSchemaOptions = {
  // Declare number columns REAL (the default). Off with SQLiteAdapter's storeWholeNumbersAsIntegers,
  // which binds whole numbers as INTEGER: a REAL column would turn them back into REAL.
  realNumberColumns?: boolean
}

// By default, number columns are declared REAL. JS numbers are doubles, and a column without a type
// stores each one as an 8-byte REAL. A REAL column stores whole numbers in SQLite's compact integer
// format on disk (0 and 1 take no space, a millisecond timestamp 6 bytes) and reads them back as
// REAL, so databases get smaller while queries see exactly the same values and types as before.
// Only tables and columns created from now on get it: SQLite can't change an existing column's type.
const encodeColumn = (column: ColumnSchema, options: EncodeSchemaOptions): SQL =>
  column.type === 'number' && options.realNumberColumns !== false
    ? `"${column.name}" real`
    : `"${column.name}"`

const encodeCreateTable = ({ name, columns }: TableSchema, options: EncodeSchemaOptions): SQL => {
  const columnsSQL = [standardColumns]
    .concat(Object.values(columns).map((column) => encodeColumn(column, options)))
    .join(', ')
  return `create table "${name}" (${columnsSQL});`
}

const encodeIndex = (column: ColumnSchema, tableName: TableName): SQL =>
  column.isIndexed
    ? `create index if not exists "${tableName}_${column.name}" on "${tableName}" ("${column.name}");`
    : ''

const encodeTableIndicies = ({ name: tableName, columns }: TableSchema): SQL =>
  Object.values(columns)
    .map((column) => encodeIndex(column, tableName))
    .concat([`create index if not exists "${tableName}__status" on "${tableName}" ("_status");`])
    .join('')

const identity = (sql: SQL, _kind?: AppSchemaUnsafeSqlKind): SQL => sql

const encodeTable = (table: TableSchema, options: EncodeSchemaOptions): SQL =>
  (table.unsafeSql || identity)(encodeCreateTable(table, options) + encodeTableIndicies(table))

export const encodeSchema = (
  { tables, unsafeSql }: AppSchema,
  options: EncodeSchemaOptions = {},
): SQL => {
  const sql = Object.values(tables)
    .map((table) => encodeTable(table, options))
    .join('')
  return (unsafeSql || identity)(commonSchema + sql, 'setup')
}

export function encodeCreateIndices({ tables, unsafeSql }: AppSchema): SQL {
  const sql = Object.values(tables).map(encodeTableIndicies).join('')
  return (unsafeSql || identity)(sql, 'create_indices')
}

export function encodeDropIndices({ tables, unsafeSql }: AppSchema): SQL {
  const sql = Object.values(tables)
    .map(({ name: tableName, columns }) =>
      Object.values(columns)
        .map((column) =>
          column.isIndexed ? `drop index if exists "${tableName}_${column.name}";` : '',
        )
        .concat([`drop index if exists "${tableName}__status";`])
        .join(''),
    )
    .join('')
  return (unsafeSql || identity)(sql, 'drop_indices')
}

const encodeAddColumnsMigrationStep = (
  { table, columns, unsafeSql }: AddColumnsMigrationStep,
  options: EncodeSchemaOptions,
): SQL =>
  columns
    .map((column) => {
      const addColumn = `alter table "${table}" add ${encodeColumn(column, options)};`
      const setDefaultValue = `update "${table}" set "${column.name}" = ${encodeValue(
        nullValue(column),
      )};`
      const addIndex = encodeIndex(column, table)

      return (unsafeSql || identity)(addColumn + setDefaultValue + addIndex)
    })
    .join('')

export const encodeMigrationSteps = (
  steps: MigrationStep[],
  options: EncodeSchemaOptions = {},
): SQL =>
  steps
    .map((step) => {
      if (step.type === 'create_table') {
        return encodeTable(step.schema, options)
      } else if (step.type === 'add_columns') {
        return encodeAddColumnsMigrationStep(step, options)
      } else if (step.type === 'sql') {
        return step.sql
      } else if (step.type === 'destroy_table') {
        // (indices are dropped along with the table)
        return `drop table if exists "${step.table}";`
      }

      throw new Error(`Unsupported migration step ${(step as { type: string }).type}`)
    })
    .join('')
