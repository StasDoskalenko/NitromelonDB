// The server's own description of the synced tables. This is the whitelist the sync endpoints use:
// only these tables and columns are ever read from a push or sent in a pull (Backend.md, push 9 and
// pull 10, 13). Keep it in sync with the app's `appSchema` by hand, the same way a real backend
// keeps its database schema and the app's schema in agreement.

export type ColumnType = 'string' | 'number' | 'boolean'

export type ColumnSchema = {
  name: string
  type: ColumnType
  isOptional?: boolean
}

export type TableSchema = {
  name: string
  columns: ColumnSchema[]
  // `column` holds the id of a record in `table`. When that record is deleted, this record is
  // deleted with it (Backend.md, push 11: delete all descendants of deleted records).
  belongsTo?: { table: string; column: string }[]
}

export type ServerSchema = { tables: TableSchema[] }

export const appSchema: ServerSchema = {
  tables: [
    {
      name: 'projects',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'is_favorite', type: 'boolean' },
      ],
    },
    {
      name: 'tasks',
      columns: [
        { name: 'project_id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'position', type: 'number' },
        { name: 'is_completed', type: 'boolean' },
        // Added to the app in schema version 2 (see the migration sync tests)
        { name: 'priority', type: 'number' },
      ],
      belongsTo: [{ table: 'projects', column: 'project_id' }],
    },
    {
      name: 'comments',
      columns: [
        { name: 'task_id', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'created_at', type: 'number' },
      ],
      belongsTo: [{ table: 'tasks', column: 'task_id' }],
    },
  ],
}

// The schema of the example NotesApp (examples/NotesApp/src/model/schema.ts), for its Maestro sync
// flow. Start the server with SYNC_SERVER_SCHEMA=notes-app to use it.
export const notesAppSchema: ServerSchema = {
  tables: [
    {
      name: 'notes',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
        { name: 'pinned', type: 'boolean' },
        { name: 'rank', type: 'number' },
      ],
    },
  ],
}

export const schemas: Record<string, ServerSchema> = {
  default: appSchema,
  'notes-app': notesAppSchema,
}

// Columns the server keeps for change tracking. They're never sent to clients or read from them.
export const internalColumns = ['last_modified', 'server_created_at', 'deleted'] as const

const safeName = /^[a-z_][a-z0-9_]*$/

// Names are interpolated into SQL, so the schema itself is checked once at startup
export function validateSchema(schema: ServerSchema): void {
  const reserved = new Set<string>(['id', '_status', '_changed', ...internalColumns])
  const tableNames = new Set(schema.tables.map((table) => table.name))
  for (const table of schema.tables) {
    if (!safeName.test(table.name)) {
      throw new Error(`Unsafe table name: ${table.name}`)
    }
    for (const column of table.columns) {
      if (!safeName.test(column.name) || reserved.has(column.name)) {
        throw new Error(`Unsafe or reserved column name: ${table.name}.${column.name}`)
      }
    }
    for (const relation of table.belongsTo ?? []) {
      if (!tableNames.has(relation.table)) {
        throw new Error(
          `${table.name}.${relation.column} belongs to unknown table ${relation.table}`,
        )
      }
      if (!table.columns.some((column) => column.name === relation.column)) {
        throw new Error(`${table.name} has no column ${relation.column}`)
      }
    }
  }
}
