import DatabaseDriver from './DatabaseDriver'
import type { InitializeStatus, NativeBridgeBatchOperation, SQLiteArg } from '../type'

type Connection = {
  driver: DatabaseDriver
  queue: Array<() => void>
  status: string
}

type TaggedError = Error & { type: string; databaseVersion?: number }

function asTaggedError(error: unknown): TaggedError | null {
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const tagged = error as { type?: unknown; databaseVersion?: unknown; message?: unknown }
    if (typeof tagged.type === 'string') {
      return error as TaggedError
    }
  }
  return null
}

class DatabaseBridge {
  connections: { [key: number]: Connection } = {}

  // MARK: - Asynchronous connections

  connected(tag: number, driver: DatabaseDriver): void {
    this.connections[tag] = { driver, queue: [], status: 'connected' }
  }

  waiting(tag: number, driver: DatabaseDriver): void {
    this.connections[tag] = { driver, queue: [], status: 'waiting' }
  }

  initialize(
    tag: number,
    databaseName: string,
    schemaVersion: number,
    resolve: (status: InitializeStatus) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    let driver: DatabaseDriver | undefined
    try {
      this.assertNoConnection(tag)
      driver = new DatabaseDriver()
      driver.initialize(databaseName, schemaVersion)
      this.connected(tag, driver)

      resolve({ code: 'ok' })
    } catch (error) {
      const tagged = asTaggedError(error)
      if (driver && tagged?.type === 'SchemaNeededError') {
        this.waiting(tag, driver)
        resolve({ code: 'schema_needed' })
      } else if (driver && tagged?.type === 'MigrationNeededError') {
        this.waiting(tag, driver)
        resolve({ code: 'migrations_needed', databaseVersion: tagged.databaseVersion as number })
      } else {
        this.sendReject(reject, error as Error, 'initialize')
      }
    }
  }

  setUpWithSchema(
    tag: number,
    databaseName: string,
    schema: string,
    schemaVersion: number,
    resolve: (value: boolean) => void,
    _reject: () => void,
  ): void {
    const driver = new DatabaseDriver()
    driver.setUpWithSchema(databaseName, schema, schemaVersion)
    this.connectDriverAsync(tag, driver)
    resolve(true)
  }

  setUpWithMigrations(
    tag: number,
    databaseName: string,
    migrations: string,
    fromVersion: number,
    toVersion: number,
    resolve: (value: boolean) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    try {
      const driver = new DatabaseDriver()
      driver.setUpWithMigrations(databaseName, {
        from: fromVersion,
        to: toVersion,
        sql: migrations,
      })
      this.connectDriverAsync(tag, driver)
      resolve(true)
    } catch (error) {
      this.disconnectDriver(tag)
      this.sendReject(reject, error as Error, 'setUpWithMigrations')
    }
  }

  // MARK: - Asynchronous actions

  find(
    tag: number,
    table: string,
    id: string,
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'find', (driver) => driver.find(table, id))
  }

  query(
    tag: number,
    table: string,
    query: string,
    args: SQLiteArg[],
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'query', (driver) =>
      driver.cachedQuery(table, query, args),
    )
  }

  queryIds(
    tag: number,
    query: string,
    args: SQLiteArg[],
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'queryIds', (driver) => driver.queryIds(query, args))
  }

  unsafeQueryRaw(
    tag: number,
    query: string,
    args: SQLiteArg[],
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'unsafeQueryRaw', (driver) =>
      driver.unsafeQueryRaw(query, args),
    )
  }

  count(
    tag: number,
    query: string,
    args: SQLiteArg[],
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'count', (driver) => driver.count(query, args))
  }

  batch(
    tag: number,
    operations: NativeBridgeBatchOperation[],
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'batch', (driver) => driver.batch(operations))
  }

  unsafeResetDatabase(
    tag: number,
    schema: string,
    schemaVersion: number,
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'unsafeResetDatabase', (driver) =>
      driver.unsafeResetDatabase({ version: schemaVersion, sql: schema }),
    )
  }

  getLocal(
    tag: number,
    key: string,
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
  ): void {
    this.withDriver(tag, resolve, reject, 'getLocal', (driver) => driver.getLocal(key))
  }

  // MARK: - Helpers

  withDriver(
    tag: number,
    resolve: (value: unknown) => void,
    reject: (code: string, message: string, error: Error) => void,
    functionName: string,
    action: (driver: DatabaseDriver) => unknown,
  ): void {
    try {
      const connection = this.connections[tag]
      if (!connection) {
        throw new Error(`No driver for with tag ${tag} available`)
      }
      if (connection.status === 'connected') {
        const result = action(connection.driver)
        resolve(result)
      } else if (connection.status === 'waiting') {
        // consoleLog('Operation for driver (tagID) enqueued')
        // try again when driver is ready
        connection.queue.push(() => {
          this.withDriver(tag, resolve, reject, functionName, action)
        })
      }
    } catch (error) {
      this.sendReject(reject, error as Error, functionName)
    }
  }

  connectDriverAsync(tag: number, driver: DatabaseDriver): void {
    const { queue = [] } = this.connections[tag]
    this.connections[tag] = { driver, queue: [], status: 'connected' }

    queue.forEach((operation) => operation())
  }

  disconnectDriver(tag: number): void {
    const { queue = [] } = this.connections[tag]
    delete this.connections[tag]

    queue.forEach((operation) => operation())
  }

  assertNoConnection(tag: number): void {
    if (this.connections[tag]) {
      throw new Error(`A driver with tag ${tag} already set up`)
    }
  }

  sendReject(
    reject: ((code: string, message: string, error: Error) => void) | undefined,
    error: Error,
    functionName: string,
  ): void {
    if (reject) {
      reject(`db.${functionName}.error`, error.message, error)
    } else {
      throw new Error(`db.${functionName} missing reject (${error.message})`)
    }
  }
}

const databaseBridge: DatabaseBridge = new DatabaseBridge()

export default databaseBridge
