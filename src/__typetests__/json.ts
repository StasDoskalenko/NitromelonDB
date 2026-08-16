import Model from '../Model'
import { type RelationId } from '../Relation'
import json from '../decorators/json'
import type { JsonOptions } from '../decorators'

type ContactInfo = { email: string }

const sanitizeContact = (source: ContactInfo): ContactInfo =>
  source && typeof source.email === 'string' ? source : { email: '' }

const accessLevelSanitizer = (accessLevels: string): string[] =>
  typeof accessLevels === 'string' ? accessLevels.split(',') : []

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

  @json('access_levels', accessLevelSanitizer)
  accessLevels!: string[]

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

class Account extends Model {
  static table = 'accounts'

  @wrappedJson('access_levels', accessLevelSanitizer)
  accessLevels!: string[]
}

export { Person, Account }

export const personType: Person = null as unknown as Person
export const email: string = personType.contactInfo.email
export const accessLevels: string[] = personType.accessLevels
export const reactions: string[] = personType.reactions
export const accountAccessLevels: string[] = (null as unknown as Account).accessLevels
export const relationId: RelationId<Model> = 'record-id'
