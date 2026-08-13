/* eslint-disable no-use-before-define */

import allPass from '../../utils/fp/allPass'
import anyPass from '../../utils/fp/anyPass'

import invariant from '../../utils/common/invariant'

import type { QueryDescription, WhereDescription, Where } from '../../QueryDescription'
import type { RawRecord } from '../../RawRecord'
import type { Value, CompoundValue } from '../../QueryDescription'
import type Model from '../../Model'

import operators from './operators'
import canEncodeMatcher, { forbiddenError } from './canEncode'

export type Matcher<_Element extends Model = Model> = (raw: RawRecord) => boolean

const encodeWhereDescription =
  (description: WhereDescription): Matcher =>
  (rawRecord) => {
    const left = rawRecord[description.left] as Value
    const { comparison } = description
    const operator = operators[comparison.operator]

    const compRight = comparison.right
    let right: CompoundValue

    // TODO: What about `undefined`s ?
    if ('value' in compRight && compRight.value !== undefined) {
      right = compRight.value
    } else if ('values' in compRight && compRight.values) {
      right = compRight.values
    } else if ('column' in compRight && compRight.column) {
      right = rawRecord[compRight.column] as Value
    } else {
      throw new Error('Invalid comparisonRight')
    }

    return operator(left, right)
  }

const encodeWhere = (where: Where): Matcher => {
  switch (where.type) {
    case 'where':
      return encodeWhereDescription(where)
    case 'and':
      return allPass(where.conditions.map(encodeWhere))
    case 'or':
      return anyPass(where.conditions.map(encodeWhere))
    case 'on':
      throw new Error(
        'Illegal Q.on found -- nested Q.ons require explicit Q.experimentalJoinTables declaration',
      )
    default:
      throw new Error(`Illegal clause ${where.type}`)
  }
}

const encodeConditions = (conditions: Where[]): Matcher => allPass(conditions.map(encodeWhere))

export default function encodeMatcher<Element extends Model>(
  query: QueryDescription,
): Matcher<Element> {
  invariant(canEncodeMatcher(query), forbiddenError)

  return encodeConditions(query.where)
}
