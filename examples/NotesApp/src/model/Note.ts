import { Collection, Model } from 'nitromelondb'
import { date, field, readonly, text, writer } from 'nitromelondb/decorators'
import { NOTES_TABLE } from './schema'

// Note's own Collection: `create()` has no existing record to be a Model
// instance method on, so this is where @writer creation helpers live. Kept
// in this file, not a separate one — it's still just "everything about
// notes."
export class NotesCollection extends Collection<Note> {
  @writer
  async addNote(title: string, body: string): Promise<Note> {
    return this.create((note) => {
      note.title = title
      note.body = body
      // createdAt is set automatically by the framework (see @date below);
      // sortOrder has no such mechanism, so it's set directly here — no
      // shared counter needed, since real adds are never sub-millisecond.
      note.sortOrder = Date.now()
      note.pinned = false
    })
  }
}

export default class Note extends Model {
  static table = NOTES_TABLE
  static associatedCollectionClass = NotesCollection

  @text('title')
  title!: string
  @text('body')
  body!: string
  // Set automatically on collection.create() / prepareCreate(). Not @readonly:
  // the seed loop (useNotes.ts) deliberately backdates these to stagger 100
  // notes for the demo, which @readonly would reject.
  @date('created_at')
  createdAt!: Date
  // Set automatically on model.update() / prepareUpdate(). Nothing needs to
  // override it, so this one is @readonly.
  @readonly
  @date('updated_at')
  updatedAt!: Date
  @field('pinned')
  pinned!: boolean
  @field('sort_order')
  sortOrder!: number

  @writer
  async togglePinned() {
    await this.update((note) => {
      note.pinned = !note.pinned
    })
  }

  @writer
  async deleteForever() {
    await this.destroyPermanently()
  }
}
