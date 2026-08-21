import { Model } from 'nitromelondb'
import { date, field, text, writer } from 'nitromelondb/decorators'
import { NOTES_TABLE } from './schema'

export default class Note extends Model {
  static table = NOTES_TABLE

  @text('title')
  title!: string
  @text('body')
  body!: string
  @date('created_at')
  createdAt!: Date
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
