import { Model, type RelationId } from 'nitromelondb'
import { json, type JsonOptions } from 'nitromelondb/decorators'

type ContactInfo = { email: string }

// Typed sanitizers must be accepted (WatermelonDB Flow treated this as any;
// `(source: unknown) => unknown` is contravariant and rejected callbacks like this).
const sanitizeContact = (source: ContactInfo): ContactInfo =>
  source && typeof source.email === 'string' ? source : { email: '' }

const sanitizeTags = (raw: string): string[] =>
  typeof raw === 'string' ? raw.split(',') : []

const sanitizeReactions = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map(String) : []

class Person extends Model {
  static table = 'people'

  @json('contact_info', sanitizeContact)
  contactInfo!: ContactInfo

  @json('contact_info', sanitizeContact, { memo: true })
  contactInfoMemoized!: ContactInfo

  @json('contact_info', sanitizeContact, {})
  contactInfoDefaultMemo!: ContactInfo

  @json('tags', sanitizeTags)
  tags!: string[]

  @json('reactions', sanitizeReactions)
  reactions!: string[]
}

export function wrappedJson<T>(
  rawFieldName: string,
  sanitizer: (source: T, model?: Model) => unknown,
  options?: Parameters<typeof json>[2],
): PropertyDecorator {
  return json(rawFieldName, sanitizer, options)
}

export function wrappedJsonWithOptions<T>(
  rawFieldName: string,
  sanitizer: (source: T, model?: Model) => unknown,
  options?: JsonOptions,
): PropertyDecorator {
  return json(rawFieldName, sanitizer, options)
}

class Note extends Model {
  static table = 'notes'

  @wrappedJson('tags', sanitizeTags)
  tags!: string[]
}

export { Person, Note }
export const personType: Person = null as unknown as Person
export const email: string = personType.contactInfo.email
export const tags: string[] = personType.tags
export const reactions: string[] = personType.reactions
export const noteTags: string[] = (null as unknown as Note).tags
export const relationId: RelationId<Model> = 'record-id'
