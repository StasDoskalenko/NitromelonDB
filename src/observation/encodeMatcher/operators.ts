/* eslint-disable eqeqeq */

import likeToRegexp from '../../utils/fp/likeToRegexp'

import type { Value, CompoundValue, Operator } from '../../QueryDescription'

type OperatorFunction = (left: Value, right: CompoundValue) => boolean

const between: OperatorFunction = (left, range) => {
  const [lower, upper] = range as [Value, Value]
  return (left as number) >= (lower as number) && (left as number) <= (upper as number)
}

export const rawFieldEquals: OperatorFunction = (left, right) => left == right

const rawFieldNotEquals: OperatorFunction = (left, right) => !(left == right)

const noNullComparisons =
  (operator: OperatorFunction): OperatorFunction =>
  (left, right) => {
    // return false if any operand is null/undefined
    if (left == null || right == null) {
      return false
    }

    return operator(left, right)
  }

// Same as `a > b`, but `5 > undefined` is also true
const weakGt: OperatorFunction = (left, right) =>
  (left as number) > (right as number) || (left != null && right == null)

const handleLikeValue = (value: Value, defaultV: string): string =>
  typeof value === 'string' ? value : defaultV

export const like: OperatorFunction = (left, right) => {
  const leftV = handleLikeValue(left, '')

  return likeToRegexp(right as string).test(leftV)
}

export const notLike: OperatorFunction = (left, right) => {
  // Mimic SQLite behaviour
  if (left === null) {
    return false
  }
  const leftV = handleLikeValue(left, '')

  return !likeToRegexp(right as string).test(leftV)
}

const oneOf: OperatorFunction = (value, values) => (values as Value[]).includes(value)
const notOneOf: OperatorFunction = (value, values) => !(values as Value[]).includes(value)

const gt: OperatorFunction = (a, b) => (a as number) > (b as number)
const gte: OperatorFunction = (a, b) => (a as number) >= (b as number)
const lt: OperatorFunction = (a, b) => (a as number) < (b as number)
const lte: OperatorFunction = (a, b) => (a as number) <= (b as number)
const includes: OperatorFunction = (a, b) => typeof a === 'string' && a.includes(b as string)

const operators: { [operator in Operator]: OperatorFunction } = {
  eq: rawFieldEquals,
  notEq: rawFieldNotEquals,
  gt: noNullComparisons(gt),
  gte: noNullComparisons(gte),
  weakGt,
  lt: noNullComparisons(lt),
  lte: noNullComparisons(lte),
  oneOf,
  notIn: noNullComparisons(notOneOf),
  between,
  like,
  notLike,
  includes,
}

export default operators
