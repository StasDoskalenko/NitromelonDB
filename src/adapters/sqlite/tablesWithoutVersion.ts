// A database with tables but no schema version (PRAGMA user_version = 0) wasn't set up by
// NitromelonDB, or its file header is damaged. Version 0 normally means a new, empty database,
// which gets the schema set up from scratch -- doing that here would silently delete those tables.
// So initialization refuses instead, and `database.unsafeResetDatabase()` is the explicit way to
// start over. The native adapter (HybridNitromelonDatabase.cpp) uses the same check and message.

// Tables SQLite creates for itself, and Android's SQLiteOpenHelper bookkeeping, don't count
export const USER_OBJECTS_QUERY = `SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name != 'android_metadata' LIMIT 1`

export function tablesWithoutVersionMessage(dbName: string): string {
  return `The database "${dbName}" has tables but no schema version (PRAGMA user_version is 0), so it wasn't set up by NitromelonDB, or its file header is damaged. Setting it up as a new database would delete those tables, so NitromelonDB won't do it on its own. To delete them and start over, call database.unsafeResetDatabase().`
}

export type TablesWithoutVersionError = Error & { isTablesWithoutVersion: true }

export function tablesWithoutVersionError(dbName: string): TablesWithoutVersionError {
  return Object.assign(new Error(tablesWithoutVersionMessage(dbName)), {
    isTablesWithoutVersion: true as const,
  })
}

export function isTablesWithoutVersionError(error: unknown): error is TablesWithoutVersionError {
  return (error as { isTablesWithoutVersion?: unknown } | null)?.isTablesWithoutVersion === true
}
