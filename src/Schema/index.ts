// NOTE: Only require files needed (critical path on web)
import invariant from '../utils/common/invariant'

import type Model from '../Model'

/**
 * String that signifies a database table name (mapping to WatermelonDB Models)
 */
export type TableName<_T extends Model = Model> = string

/**
 * String that signifies a database column name (mapping to WatermelonDB fields)
 */
export type ColumnName = string

/**
 * Type of a column
 */
export type ColumnType = 'string' | 'number' | 'boolean'

/**
 * Definition of a table column
 */
export type ColumnSchema = Readonly<{
  name: ColumnName
  type: ColumnType
  isOptional?: boolean
  isIndexed?: boolean
}>

export type ColumnMap = { [name: ColumnName]: ColumnSchema }

export type TableSchemaSpec = {
  name: TableName
  columns: ColumnSchema[]
  unsafeSql?: (sql: string) => string
}

export type TableSchema = Readonly<{
  name: TableName
  // depending on operation, it's faster to use map or array
  columns: ColumnMap
  columnArray: ColumnSchema[]
  unsafeSql?: (sql: string) => string
}>

export type TableMap = { [name: TableName]: TableSchema }

export type SchemaVersion = number

export type AppSchemaUnsafeSqlKind = 'setup' | 'create_indices' | 'drop_indices'

export type AppSchemaSpec = {
  version: number
  tables: TableSchema[]
  unsafeSql?: (sql: string, kind: AppSchemaUnsafeSqlKind) => string
}

export type AppSchema = Readonly<{
  version: SchemaVersion
  tables: TableMap
  unsafeSql?: (sql: string, kind: AppSchemaUnsafeSqlKind) => string
}>

/**
 * Creates a typed TableName
 */
export function tableName<T extends Model>(name: string): TableName<T> {
  return name
}

/**
 * Creates a typed ColumnName
 */
export function columnName(name: string): ColumnName {
  return name
}

/**
 * Creates a database schema object. Pass table definitions created using {@see tableSchema}
 */
export function appSchema({ version, tables: tableList, unsafeSql }: AppSchemaSpec): AppSchema {
  if (process.env.NODE_ENV !== 'production') {
    invariant(version > 0, `Schema version must be greater than 0`)
  }
  const tables: TableMap = tableList.reduce<TableMap>((map, table) => {
    if (process.env.NODE_ENV !== 'production') {
      invariant(typeof table === 'object' && table.name, `Table schema must contain a name`)
    }

    map[table.name] = table
    return map
  }, {})

  return { version, tables, unsafeSql }
}

const validateName = (name: string) => {
  if (process.env.NODE_ENV !== 'production') {
    invariant(
      !['id', '_changed', '_status', 'local_storage'].includes(name.toLowerCase()),
      `Invalid column or table name '${name}' - reserved by WatermelonDB`,
    )
    const checkName = (
      require('../utils/fp/checkName') as { default: (value: string) => string }
    ).default
    checkName(name)
  }
}

export function validateColumnSchema(column: ColumnSchema): void {
  if (process.env.NODE_ENV !== 'production') {
    invariant(column.name, `Missing column name`)
    validateName(column.name)
    invariant(
      ['string', 'boolean', 'number'].includes(column.type),
      `Invalid type ${column.type} for column '${column.name}' (valid: string, boolean, number)`,
    )
    if (column.name === 'created_at' || column.name === 'updated_at') {
      invariant(
        column.type === 'number' && !column.isOptional,
        `${column.name} must be of type number and not optional`,
      )
    }
    if (column.name === 'last_modified') {
      invariant(
        column.type === 'number',
        `For compatibility reasons, column last_modified must be of type 'number', and should be optional`,
      )
    }
  }
}

/**
 * Creates a typed TableSchema
 */
export function tableSchema({ name, columns: columnArray, unsafeSql }: TableSchemaSpec): TableSchema {
  if (process.env.NODE_ENV !== 'production') {
    invariant(name, `Missing table name in schema`)
    validateName(name)
  }

  const columns: ColumnMap = columnArray.reduce<ColumnMap>((map, column) => {
    if (process.env.NODE_ENV !== 'production') {
      validateColumnSchema(column)
    }
    map[column.name] = column
    return map
  }, {})

  return { name, columns, columnArray, unsafeSql }
}
