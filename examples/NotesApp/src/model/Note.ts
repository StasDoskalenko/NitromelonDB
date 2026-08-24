import type { Collection } from 'nitromelondb'
import { Model, Q } from 'nitromelondb'
import { date, field, readonly, text, writer } from 'nitromelondb/decorators'
import { NOTES_TABLE } from './schema'

export default class Note extends Model {
  static table = NOTES_TABLE

  // Collection.create() has no existing Note instance to be a method on, so
  // this takes the collection as an argument — but it still lives here, next
  // to the model it creates, instead of inline in the screen.
  //
  // rank is a dense 1..N position, 1 = top: adding a note shifts every
  // existing rank up by one and inserts the new note at rank 1, all batched
  // into a single write.
  static async addNote(notes: Collection<Note>, title: string, body: string): Promise<Note> {
    return notes.database.write(async () => {
      const existing = await notes.query().fetch()
      const shifted = existing.map((note) => note.prepareUpdate((n) => (n.rank += 1)))
      const created = notes.prepareCreate((note) => {
        note.title = title
        note.body = body
        note.rank = 1
        note.pinned = false
      })
      await notes.database.batch(...shifted, created)
      return created
    })
  }

  @text('title')
  title!: string
  @text('body')
  body!: string
  // Set automatically on collection.create() / prepareCreate(). Not @readonly:
  // the seed loop (database.ts) deliberately backdates these to stagger 100
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
  // Dense 1..N position, 1 = top. Not the library's SortOrder ('asc' | 'desc',
  // a query-direction type) — this is a per-row rank. See addNote/deleteForever.
  @field('rank')
  rank!: number

  @writer
  async togglePinned() {
    await this.update((note) => {
      note.pinned = !note.pinned
    })
  }

  @writer
  async deleteForever() {
    const notes = this.collections.get<Note>(NOTES_TABLE)
    const following = await notes.query(Q.where('rank', Q.gt(this.rank))).fetch()
    const shifted = following.map((note) => note.prepareUpdate((n) => (n.rank -= 1)))
    await this.database.batch(...shifted, this.prepareDestroyPermanently())
  }
}
