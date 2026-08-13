// Compatibility shims for remaining Flow-era .d.ts files.
// Prefer built-in TypeScript utilities in converted modules.

export type $Exact<Type> = Type
export type $RE<Type> = Readonly<Type>
export type $Shape<T> = Partial<T>
export type $NonMaybeType<T> = NonNullable<T>
export type $ObjMap<O, T> = { [K in keyof O]: T }
export type $Keys<Type> = keyof Type
export type $ReadOnlyArray<T> = readonly T[]

export type $Call<F, T = never> = F extends (arg: T) => infer R ? R : never
