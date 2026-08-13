/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */

type Predicate<T, Obj> = (value: T, key: string, obj: Obj) => boolean

function filterObj<T, Obj extends Record<string, T>>(
  predicate: Predicate<T, Obj>,
  obj?: Obj,
): Partial<Obj> | ((obj: Obj) => Partial<Obj>) {
  if (arguments.length === 1) {
    return (_obj: Obj) => filterObj(predicate, _obj) as Partial<Obj>
  }

  const result: Record<string, T> = {}
  let value
  for (const prop in obj) {
    value = obj[prop]
    if (predicate(value, prop, obj as Obj)) {
      result[prop] = value
    }
  }
  return result as Partial<Obj>
}

export default filterObj
