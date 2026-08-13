// NOTE: Only require files needed (critical path on web)
import sortBy from '../../utils/fp/sortBy'
import invariant from '../../utils/common/invariant'
import isObj from '../../utils/fp/isObj'

import type { ColumnSchema, TableName, TableSchema, TableSchemaSpec, SchemaVersion } from '../index'
import { tableSchema, validateColumnSchema } from '../index'

export type CreateTableMigrationStep = Readonly<{
  type: 'create_table'
  schema: TableSchema
}>

export type AddColumnsMigrationStep = Readonly<{
  type: 'add_columns'
  table: TableName
  columns: ColumnSchema[]
  unsafeSql?: ((sql: string) => string) | undefined
}>

export type SqlMigrationStep = Readonly<{
  type: 'sql'
  sql: string
}>

export type MigrationStep = CreateTableMigrationStep | AddColumnsMigrationStep | SqlMigrationStep

export type Migration = Readonly<{
  toVersion: SchemaVersion
  steps: MigrationStep[]
}>

export type SchemaMigrationsSpec = Readonly<{
  migrations: Migration[]
}>

export type SchemaMigrations = Readonly<{
  validated: true
  minVersion: SchemaVersion
  maxVersion: SchemaVersion
  sortedMigrations: Migration[]
}>

// Creates a specification of how to migrate between different versions of
// database schema. Every time you change the database schema, you must
// create a corresponding migration.
//
// See docs for more details
export function schemaMigrations(migrationSpec: SchemaMigrationsSpec): SchemaMigrations {
  const { migrations } = migrationSpec

  if (process.env.NODE_ENV !== 'production') {
    // validate migrations spec object
    invariant(Array.isArray(migrations), 'Missing migrations array')

    // validate migrations format
    migrations.forEach((migration) => {
      invariant(isObj(migration), `Invalid migration (not an object) in schema migrations`)
      const { toVersion, steps } = migration
      invariant(typeof toVersion === 'number', 'Invalid migration - `toVersion` must be a number')
      invariant(
        toVersion >= 2,
        `Invalid migration to version ${toVersion}. Minimum possible migration version is 2`,
      )
      invariant(
        Array.isArray(steps) && steps.every((step) => typeof step.type === 'string'),
        `Invalid migration steps for migration to version ${toVersion}. 'steps' should be an array of migration step calls`,
      )
    })
  }

  // TODO: Force order of migrations?
  const sortedMigrations = sortBy((migration) => migration.toVersion, migrations)
  const oldestMigration = sortedMigrations[0]
  const newestMigration = sortedMigrations[sortedMigrations.length - 1]
  const minVersion = oldestMigration ? oldestMigration.toVersion - 1 : 1
  const maxVersion = newestMigration?.toVersion || 1

  if (process.env.NODE_ENV !== 'production') {
    // validate that migration spec is without gaps and duplicates
    sortedMigrations.reduce<number | null>((maxCoveredVersion, migration) => {
      const { toVersion } = migration
      if (maxCoveredVersion) {
        invariant(
          toVersion === maxCoveredVersion + 1,
          `Invalid migrations! Migrations listed cover range from version ${minVersion} to ${maxCoveredVersion}, but migration ${JSON.stringify(
            migration,
          )} is to version ${toVersion}. Migrations must be listed without gaps, or duplicates.`,
        )
      }
      return toVersion
    }, null)
  }

  return {
    sortedMigrations,
    minVersion,
    maxVersion,
    validated: true,
  }
}

export function createTable(tableSchemaSpec: TableSchemaSpec): CreateTableMigrationStep {
  const schema = tableSchema(tableSchemaSpec)
  return { type: 'create_table', schema }
}

export function addColumns({
  table,
  columns,
  unsafeSql,
}: {
  table: TableName
  columns: ColumnSchema[]
  unsafeSql?: ((sql: string) => string) | undefined
}): AddColumnsMigrationStep {
  if (process.env.NODE_ENV !== 'production') {
    invariant(table, `Missing table name in addColumn()`)
    invariant(columns && Array.isArray(columns), `Missing 'columns' or not an array in addColumn()`)
    columns.forEach((column) => validateColumnSchema(column))
  }

  return { type: 'add_columns', table, columns, unsafeSql }
}

export function unsafeExecuteSql(sql: string): SqlMigrationStep {
  if (process.env.NODE_ENV !== 'production') {
    invariant(typeof sql === 'string', `SQL passed to unsafeExecuteSql is not a string`)
    invariant(
      sql.trimEnd().endsWith(';'),
      `SQL passed to unsafeExecuteSql must end with a semicolon (it would work when executed individually but break if multiple migration steps are executed)`,
    )
  }
  return { type: 'sql', sql }
}
