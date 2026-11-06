// Decorator types that type-check under both TypeScript settings. With
// `experimentalDecorators: true`, TypeScript checks the legacy `(target, key)` signatures; with
// standard (TC39 2023-11) decorators, it checks the `(value, context)` ones.

type LegacyPropertyDecorator = (target: object, propertyKey: string | symbol) => void

type StandardAccessorDecorator = <This, Value>(
  value: ClassAccessorDecoratorTarget<This, Value>,
  context: ClassAccessorDecoratorContext<This, Value>,
) => ClassAccessorDecoratorResult<This, Value> | void

// A plain field under standard decorators: supported as a fallback (see modelFieldDecorator).
type StandardFieldDecorator = <This, Value>(
  value: undefined,
  context: ClassFieldDecoratorContext<This, Value>,
) => ((initialValue: Value) => Value) | void

// @field, @text, @date, @json, @relation, @immutableRelation, @children
export type ModelFieldDecorator = LegacyPropertyDecorator &
  StandardAccessorDecorator &
  StandardFieldDecorator

type StandardSetterDecorator = <This, Value>(
  value: (this: This, value: Value) => void,
  context: ClassSetterDecoratorContext<This, Value>,
) => ((this: This, value: Value) => void) | void

type LegacyAccessorDecorator = (
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor | void

// @nochange, @readonly: usable bare (`@readonly`) or called (`@readonly()`)
export type FieldModifierDecorator = ModelFieldDecorator &
  LegacyAccessorDecorator &
  StandardSetterDecorator

export type BareOrCalledDecorator<D> = D & (() => D)

type StandardMethodDecorator = <This, Args extends unknown[], Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => (this: This, ...args: Args) => Return

type LegacyMethodDecorator = <T>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<T>,
) => TypedPropertyDescriptor<T> | void

// @writer, @reader, @action
export type ModelMethodDecorator = LegacyMethodDecorator & StandardMethodDecorator

type StandardGetterDecorator = <This, Value>(
  value: (this: This) => Value,
  context: ClassGetterDecoratorContext<This, Value>,
) => ((this: This) => Value) | void

// @lazy: a getter (`@lazy get x()`) in both modes, or a field with an initializer, which standard
// decorators can only evaluate eagerly.
export type LazyDecorator = LegacyPropertyDecorator &
  LegacyAccessorDecorator &
  StandardGetterDecorator &
  StandardFieldDecorator &
  StandardAccessorDecorator
