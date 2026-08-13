import { unnest } from '../../utils/fp'

import type { SchemaMigrations, MigrationStep } from './index'
import type { SchemaVersion } from '../index'

export function stepsForMigration({
  migrations: schemaMigrations,
  fromVersion,
  toVersion,
}: {
  migrations: SchemaMigrations
  fromVersion: SchemaVersion
  toVersion: SchemaVersion
}): MigrationStep[] | null {
  const { sortedMigrations, minVersion, maxVersion } = schemaMigrations

  // see if migrations in this range are available
  if (fromVersion < minVersion || toVersion > maxVersion) {
    return null
  }

  // return steps
  const matchingMigrations = sortedMigrations.filter(
    ({ toVersion: version }) => version > fromVersion && version <= toVersion,
  )

  return unnest(matchingMigrations.map((migration) => migration.steps))
}
