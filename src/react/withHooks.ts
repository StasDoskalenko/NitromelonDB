import { type HOC, createFactory } from './helpers'

export default function withHooks<PropsInput extends object, NewProps extends object>(
  hookTransformer: (props: PropsInput) => NewProps,
): HOC<PropsInput & NewProps, PropsInput> {
  return (BaseComponent) => {
    const factory = createFactory(BaseComponent)
    function WithHooks(props: PropsInput) {
      const newProps = hookTransformer(props)
      return factory({ ...props, ...newProps })
    }
    if (process.env.NODE_ENV !== 'production') {
      const baseName = BaseComponent.displayName || BaseComponent.name || 'anon'
      WithHooks.displayName = `withHooks[${baseName}]`
    }
    return WithHooks
  }
}
