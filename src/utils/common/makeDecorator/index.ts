export type Descriptor = PropertyDescriptor

// The context object standard (TC39 2023-11) decorators get as their second argument.
// Legacy decorators get a property key there instead, which is how the two are told apart.
export type StandardDecoratorContext = {
  kind: 'class' | 'method' | 'getter' | 'setter' | 'field' | 'accessor'
  name: string | symbol
  static?: boolean
  private?: boolean
  addInitializer(initializer: (this: unknown) => void): void
}

export function isStandardDecoratorContext(value: unknown): value is StandardDecoratorContext {
  return value !== null && typeof value === 'object' && 'kind' in value && 'name' in value
}

export type RawDecorator = (
  target: unknown,
  keyOrContext: unknown,
  descriptor?: Descriptor,
) => unknown
export type Decorator = (...args: unknown[]) => unknown

// Converts a function with signature `(args) => (target, key, descriptor)` to a decorator
// that works both when called `@decorator foo` and with arguments, like `@decorator(arg) foo`.
// A bare `@decorator` gets (target, key, descriptor) from legacy decorators, and
// (value, context) from standard (2023-11) ones.
export default function makeDecorator(decorator: (...args: unknown[]) => RawDecorator): Decorator {
  return (...args: unknown[]) => {
    const isBareUse = args.length >= 3 || (args.length === 2 && isStandardDecoratorContext(args[1]))
    if (!isBareUse) {
      // Decorator called with an argument, JS expects a decorator function
      return decorator(...args)
    }

    // Decorator called without an argument, JS expects a descriptor object (or, for standard
    // decorators, a replacement value)
    return decorator()(args[0], args[1], args[2] as Descriptor | undefined)
  }
}
