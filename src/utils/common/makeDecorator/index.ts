export type Descriptor = PropertyDescriptor
export type RawDecorator = (target: object, key: string, descriptor: Descriptor) => Descriptor
export type Decorator = (...args: unknown[]) => Descriptor | RawDecorator

// Converts a function with signature `(args) => (target, key, descriptor)` to a decorator
// that works both when called `@decorator foo` and with arguments, like `@decorator(arg) foo`
export default function makeDecorator(decorator: (...args: unknown[]) => RawDecorator): Decorator {
  return (...args: unknown[]) => {
    // Decorator called with an argument, JS expects a decorator function
    if (args.length < 3) {
      return decorator(...args)
    }

    // Decorator called without an argument, JS expects a descriptor object
    return decorator()(args[0] as object, args[1] as string, args[2] as Descriptor)
  }
}
