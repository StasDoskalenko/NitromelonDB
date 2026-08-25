import sortBy from '../utils/fp/sortBy'
import invariant from '../utils/common/invariant'

import type { SchemaVersion } from '../Schema'
import type Database from './index'

export type SeedStep = Readonly<{
  // Which schema version this step needs -- it only runs once the database has actually reached
  // this version (fresh installs get the latest schema immediately; upgrades reach it via
  // migrations). Ties seed data to the schema shape it was written against, the same way a
  // migration's `toVersion` does, instead of an independent, easy-to-forget-to-bump counter.
  schemaVersion: SchemaVersion
  run: (database: Database) => Promise<void>
  // Extra attempts if `run` throws, before treating it as a real failure (reported via
  // onError/logger.error, same as without retries) -- e.g. for a step whose `run` does something
  // occasionally-flaky like a network fetch. 0 (default, if omitted) = no retry, fail on the
  // first error. Retries are immediate, with no delay/backoff between attempts -- this is for
  // smoothing over an occasional transient failure, not a resilience/backoff system; a step that
  // needs one should implement it itself inside `run`.
  retries?: number | undefined
}>

export type SeedStepsSpec = Readonly<{
  steps: SeedStep[]
  onError?: ((error: unknown, context: { schemaVersion: SchemaVersion }) => void) | undefined
}>

export type DatabaseSeed = Readonly<{
  validated: true
  sortedSteps: SeedStep[]
  onError?: ((error: unknown, context: { schemaVersion: SchemaVersion }) => void) | undefined
}>

// Creates a specification of seed steps to run, each tied to the schema version it needs.
// Mirrors schemaMigrations() -- see docs for more details.
export function databaseSeed(spec: SeedStepsSpec): DatabaseSeed {
  const { steps, onError } = spec

  if (process.env.NODE_ENV !== 'production') {
    invariant(Array.isArray(steps) && steps.length > 0, 'databaseSeed() needs at least one step')

    const seenVersions = new Set<SchemaVersion>()
    steps.forEach((step) => {
      invariant(
        typeof step.schemaVersion === 'number' &&
          Number.isInteger(step.schemaVersion) &&
          step.schemaVersion >= 1,
        `Invalid seed step -- schemaVersion must be a positive integer`,
      )
      invariant(typeof step.run === 'function', `Invalid seed step -- run must be a function`)
      invariant(
        step.retries === undefined || (Number.isInteger(step.retries) && step.retries >= 0),
        `Invalid seed step -- retries must be a non-negative integer if given`,
      )
      invariant(
        !seenVersions.has(step.schemaVersion),
        `Invalid seed steps -- more than one step targets schema version ${step.schemaVersion}`,
      )
      seenVersions.add(step.schemaVersion)
    })
  }

  return {
    validated: true,
    sortedSteps: sortBy((step) => step.schemaVersion, steps),
    onError,
  }
}
