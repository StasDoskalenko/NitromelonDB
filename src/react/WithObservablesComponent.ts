import { useRef, type ReactNode } from 'react'
import { type Observable } from '../utils/rx'

import identicalArrays from '../utils/fp/identicalArrays'

import withObservables, { type ExtractedObservables, type ObservableConvertible } from './withObservables'
import compose from './compose'
import withHooks from './withHooks'

type ObservableMap = Record<string, Observable<unknown> | ObservableConvertible<unknown>>

type ExportProps<T extends ObservableMap> = {
  resetOn: unknown[]
  observables: T
  children: (values: ExtractedObservables<T>) => ReactNode
}

type InitialProps = {
  resetOn: unknown[]
  observables: ObservableMap
  children: (values: Record<string, unknown>) => ReactNode
  __triggeringProps?: unknown[]
}

const WithObservables = (props: InitialProps) => {
  const { children } = props

  return children(props)
}

const enhance = compose(
  withHooks(({ resetOn, observables }: InitialProps) => {
    const triggeringProps = useRef(resetOn)
    if (!identicalArrays(triggeringProps.current, resetOn)) {
      triggeringProps.current = resetOn
    }

    if (process.env.NODE_ENV !== 'production') {
      const keys = Object.keys(observables)
      if (
        keys.includes('resetOn') ||
        keys.includes('observables') ||
        keys.includes('children') ||
        keys.includes('__triggeringProps')
      ) {
        throw new Error(`Do not use reserved keys in WithObservables's observables props`)
      }
    }

    return {
      __triggeringProps: triggeringProps.current,
    }
  }) as (arg: unknown) => unknown,
  withObservables(['__triggeringProps'], ({ observables }: InitialProps) => observables) as (
    arg: unknown,
  ) => unknown,
)

export default enhance(WithObservables) as <T extends ObservableMap>(
  props: ExportProps<T>,
) => ReactNode
