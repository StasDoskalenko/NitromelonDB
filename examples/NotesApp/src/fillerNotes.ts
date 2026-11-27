import type { Database } from 'nitromelondb'
import { NOTES_TABLE } from './model/schema'

// For maestro-encryption/12-progress.yaml: a database big enough that encrypting and decrypting it
// take longer than the 200 ms between progress updates, even on a fast machine (about 135 MB).
export const FILLER_NOTE_COUNT = 120000

// Adds FILLER_NOTE_COUNT notes with 1 KB of random text each, in one SQL statement: SQLite writes
// them natively in seconds, where creating them as records would take a while on the JS thread.
// Raw SQL doesn't notify the list, so they show after the next launch, below the other notes.
export async function addFillerNotes(database: Database): Promise<void> {
  const sql = `
    with recursive n(x) as (select 1 union all select x + 1 from n where x < ${FILLER_NOTE_COUNT})
    insert into ${NOTES_TABLE} (id, _status, _changed, title, body, created_at, updated_at, pinned, rank)
    select lower(hex(randomblob(8))), 'created', '', 'Filler #' || x, hex(randomblob(512)),
      cast(strftime('%s', 'now') as integer) * 1000, cast(strftime('%s', 'now') as integer) * 1000,
      0, 1000000 + x
    from n`
  await database.write(async () => {
    await database.adapter.unsafeExecute({ sqls: [[sql, []]] })
  })
}
