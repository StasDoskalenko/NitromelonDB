import { Collection } from 'nitromelondb'
import { writer } from 'nitromelondb/decorators'
import type Note from './Note'

// Date.now() alone can repeat within the same millisecond for back-to-back
// adds; keep sort order strictly increasing so insertion order is stable.
// Module-scoped, not a class field: a `declare`d TS field isn't stripped by
// this app's babel pipeline the way Note's own `!`-asserted fields are, and a
// plain initialized field broke the legacy-decorators transform for this
// class (a Collection subclass — Model subclasses like Note are unaffected).
let lastSortOrder = 0

export default class NotesCollection extends Collection<Note> {
  @writer
  async addNote(title: string, body: string): Promise<Note> {
    lastSortOrder = Math.max(Date.now(), lastSortOrder + 1)
    const sortOrder = lastSortOrder
    return this.create((note) => {
      note.title = title
      note.body = body
      note.createdAt = new Date()
      note.sortOrder = sortOrder
      note.pinned = false
    })
  }
}
