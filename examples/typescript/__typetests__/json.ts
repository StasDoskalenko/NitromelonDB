import { Model, type RelationId } from 'nitromelondb'
import { json } from 'nitromelondb/decorators'

type ContactInfo = { email: string }

// Typed sanitizers must be accepted (WatermelonDB Flow treated this as any;
// `(source: unknown) => unknown` is contravariant and rejected callbacks like this).
const sanitizeContact = (source: ContactInfo): ContactInfo =>
  source && typeof source.email === 'string' ? source : { email: '' }

class Person extends Model {
  static table = 'people'

  @json('contact_info', sanitizeContact)
  contactInfo!: ContactInfo

  @json('contact_info', sanitizeContact, { memo: true })
  contactInfoMemoized!: ContactInfo

  @json('contact_info', sanitizeContact, {})
  contactInfoDefaultMemo!: ContactInfo
}

export { Person }
export const personType: Person = null as unknown as Person
export const email: string = personType.contactInfo.email
export const relationId: RelationId<Model> = 'record-id'
