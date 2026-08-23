import { addColumns, schemaMigrations } from 'nitromelondb/Schema/migrations'
import { NOTES_TABLE } from './schema'

// v1: notes(title, body, created_at)
// v2: add pinned
// v3: add sort_order (for ordered list)
// v4: add updated_at (automatic update tracking, see @readonly @date('updated_at') on Note)
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
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: NOTES_TABLE,
          columns: [{ name: 'sort_order', type: 'number' }],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: NOTES_TABLE,
          columns: [{ name: 'updated_at', type: 'number' }],
        }),
      ],
    },
  ],
})
