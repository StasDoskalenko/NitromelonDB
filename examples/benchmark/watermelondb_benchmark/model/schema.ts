import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const ITEMS_TABLE = 'items'

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: ITEMS_TABLE,
      columns: [
        { name: 'title', type: 'string' },
        { name: 'value', type: 'number' },
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
})
