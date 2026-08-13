import { createElement, type ComponentType, type ReactElement } from 'react'

export type HOC<BaseProps, EnhancedProps> = (
  component: ComponentType<BaseProps>,
) => ComponentType<EnhancedProps>

type Factory<P> = (props: P) => ReactElement | null

let _createFactory = <P,>(Component: ComponentType<P>): Factory<P> => {
  // eslint-disable-next-line react/function-component-definition, react/display-name
  return (props: P) => createElement(Component as never, props as never)
}

// undocumented binding for NT perf hack
export function _setCreateFactory(newCreateFactory: typeof _createFactory): void {
  _createFactory = newCreateFactory
}

export function createFactory<P>(Component: ComponentType<P>): Factory<P> {
  return _createFactory(Component)
}
