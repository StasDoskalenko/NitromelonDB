import Model from '../Model'
import { type RelationId } from '../Relation'
import json from '../decorators/json'

type ContactInfo = { email: string }

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
