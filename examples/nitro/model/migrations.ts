import { addColumns, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'
import { NOTES_TABLE } from './schema'

// v1: notes(title, body, created_at)
// v2: add pinned
export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: NOTES_TABLE,
          columns: [{ name: 'pinned', type: 'boolean' }],
        }),
      ],
    },
  ],
})
