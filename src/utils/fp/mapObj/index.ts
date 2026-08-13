/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */

type Mapper<T, U, Obj> = (value: T, key: string, obj: Obj) => U

function mapObj<T, U, Obj extends Record<string, T>>(
  fn: Mapper<T, U, Obj>,
  obj?: Obj,
): Record<string, U> | ((obj: Obj) => Record<string, U>) {
  if (arguments.length === 1) {
    return (_obj: Obj) => mapObj(fn, _obj) as Record<string, U>
  }

  const result: Record<string, U> = {}
  for (const prop in obj) {
    result[prop] = fn(obj[prop], prop, obj as Obj)
  }
  return result
}

export default mapObj
