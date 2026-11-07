import { Model } from 'nitromelondb'
import { field, text } from 'nitromelondb/decorators'
import { ITEMS_TABLE } from './schema'

export default class Item extends Model {
  static table = ITEMS_TABLE

  @text('title')
  title!: string
  @field('value')
  value!: number
  @field('created_at')
  createdAt!: number
}
