import { unique, groupBy, toPairs, unnest } from '../../../utils/fp'
import type { CreateTableMigrationStep, AddColumnsMigrationStep, SchemaMigrations } from '../index'
import type { TableName, ColumnName, SchemaVersion } from '../../index'
import { tableName } from '../../index'
import { stepsForMigration } from '../stepsForMigration'

import { invariant } from '../../../utils/common'

export type MigrationSyncChanges = {
  from: SchemaVersion
  tables: TableName[]
  columns: {
    table: TableName
    columns: ColumnName[]
  }[]
} | null

export default function getSyncChanges(
  migrations: SchemaMigrations,
  fromVersion: SchemaVersion,
  toVersion: SchemaVersion,
): MigrationSyncChanges {
  const steps = stepsForMigration({ migrations, fromVersion, toVersion })
  invariant(steps, 'Necessary range of migrations for sync is not available')
  invariant(
    toVersion === migrations.maxVersion,
    'getSyncChanges toVersion should be equal to maxVersion of migrations',
  )
  if (fromVersion === toVersion) {
    return null
  }

  steps.forEach((step) => {
    invariant(
      ['create_table', 'add_columns', 'sql'].includes(step.type),
      `Unknown migration step type ${step.type}. Can not perform migration sync. This most likely means your migrations are defined incorrectly. It could also be a WatermelonDB bug.`,
    )
  })

  const createTableSteps = steps.filter(
    (step): step is CreateTableMigrationStep => step.type === 'create_table',
  )
  const createdTables = createTableSteps.map((step) => step.schema.name)

  const addColumnSteps = steps.filter(
    (step): step is AddColumnsMigrationStep => step.type === 'add_columns',
  )
  type AddedColumn = { table: TableName; name: ColumnName }

  const allAddedColumns: AddedColumn[][] = addColumnSteps
    .filter((step) => !createdTables.includes(step.table))
    .map(({ table, columns }) => columns.map(({ name }) => ({ table, name })))

  const columnsByTable = toPairs(groupBy((column: AddedColumn) => column.table)(unnest(allAddedColumns)))
  const addedColumns = columnsByTable.map(([table, columnDefs]) => ({
    table: tableName(table),
    columns: unique(columnDefs.map((column) => column.name)),
  }))

  return {
    from: fromVersion,
    tables: unique(createdTables),
    columns: addedColumns,
  }
}
