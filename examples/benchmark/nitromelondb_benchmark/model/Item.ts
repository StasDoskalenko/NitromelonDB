import { Model } from 'nitromelondb'
import { field, text } from 'nitromelondb/decorators'
import { ITEMS_TABLE } from './schema'

export default class Item extends Model {
  static table = ITEMS_TABLE

  @text('title')
  accessor title!: string
  @field('value')
  accessor value!: number
  @field('created_at')
  accessor createdAt!: number
}
