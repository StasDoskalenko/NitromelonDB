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

// Passed to onDone once every pending step for this run has completed successfully -- not called
// at all if a step failed (that's onError's job instead) or if seed wasn't configured. Reflects
// only *this run*: stepsRun is empty (and durationMs near 0) when every step was already applied
// and there was nothing to do, same as a fresh install where nothing was pending gets an (empty)
// onDone just as reliably as one where something actually ran.
export type SeedDoneInfo = Readonly<{
  // Wall-clock time spent actually running pending steps -- excludes waiting for the adapter's
  // own migrations and reading the applied-version marker, so this reflects your `run` functions,
  // not setup overhead outside your control.
  durationMs: number
  // schemaVersions of the steps that actually executed this run (not ones skipped because
  // already applied) -- compare against the full steps list you defined if you want "skipped".
  stepsRun: SchemaVersion[]
}>

export type SeedStepsSpec = Readonly<{
  steps: SeedStep[]
  onError?: ((error: unknown, context: { schemaVersion: SchemaVersion }) => void) | undefined
  onDone?: ((info: SeedDoneInfo) => void) | undefined
}>

export type DatabaseSeed = Readonly<{
  validated: true
  sortedSteps: SeedStep[]
  onError?: ((error: unknown, context: { schemaVersion: SchemaVersion }) => void) | undefined
  onDone?: ((info: SeedDoneInfo) => void) | undefined
}>

// Creates a specification of seed steps to run, each tied to the schema version it needs.
// Mirrors schemaMigrations() -- see docs for more details.
export function databaseSeed(spec: SeedStepsSpec): DatabaseSeed {
  const { steps, onError, onDone } = spec

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
    onDone,
  }
}
