import { appSchema, tableSchema } from 'nitromelondb'

export const NOTES_TABLE = 'notes'

export const schema = appSchema({
  version: 4,
  tables: [
    tableSchema({
      name: NOTES_TABLE,
      columns: [
        { name: 'title', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'pinned', type: 'boolean' },
        { name: 'sort_order', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
})
