/* eslint-disable react/no-direct-mutation-state */
/* eslint-disable react/sort-comp */

import { type Observable } from '../../utils/rx'
import { Component, createElement, type ComponentType, type NamedExoticComponent, type JSX } from 'react'
import hoistNonReactStatics, { type NonReactStatics } from 'hoist-non-react-statics'

import scheduleForCleanup from './garbageCollector'

export interface ObservableConvertible<T> {
  readonly observe: () => Observable<T>
}

type ExtractObservableType<T> =
  T extends Observable<infer U> ? U : T extends ObservableConvertible<infer U> ? U : T

export type ExtractedObservables<T> = {
  [K in keyof T]: ExtractObservableType<T[K]>
}

/**
 * A property P will be present if:
 * - it is present in DecorationTargetProps
 *
 * Its value will be dependent on the following conditions
 * - if property P is present in InjectedProps and its definition extends the definition
 *   in DecorationTargetProps, then its definition will be that of DecorationTargetProps[P]
 * - if property P is not present in InjectedProps then its definition will be that of
 *   DecorationTargetProps[P]
 * - if property P is present in InjectedProps but does not extend the
 *   DecorationTargetProps[P] definition, its definition will be that of InjectedProps[P]
 */
type Matching<InjectedProps, DecorationTargetProps> = {
  [P in keyof DecorationTargetProps]: P extends keyof InjectedProps
    ? InjectedProps[P] extends DecorationTargetProps[P]
      ? DecorationTargetProps[P]
      : InjectedProps[P]
    : DecorationTargetProps[P]
}

type GetProps<C> = C extends ComponentType<infer P> ? P : never

/**
 * a property P will be present if :
 * - it is present in both DecorationTargetProps and InjectedProps
 * - InjectedProps[P] can satisfy DecorationTargetProps[P]
 * ie: decorated component can accept more types than decorator is injecting
 *
 * For decoration, inject props or ownProps are all optionally
 * required by the decorated (right hand side) component.
 * But any property required by the decorated component must be satisfied by the injected property.
 */
type Shared<InjectedProps, DecorationTargetProps> = {
  [P in Extract<keyof InjectedProps, keyof DecorationTargetProps>]?: InjectedProps[P] extends DecorationTargetProps[P]
    ? DecorationTargetProps[P]
    : never
}

type ConnectedComponent<C, P> = NamedExoticComponent<P> &
  NonReactStatics<C & ComponentType<object>> & {
    WrappedComponent: C
  }

type InferableComponentEnhancer<TInjectedProps, TNeedsProps> = <
  C extends ComponentType<Matching<TInjectedProps, GetProps<C>>>,
>(
  component: C,
) => ConnectedComponent<
  C,
  Omit<GetProps<C>, keyof Shared<TInjectedProps, GetProps<C>>> & TNeedsProps
>

type TriggerProps<A> = Array<keyof A> | null
type GetObservables<A, B> = (props: A) => B
type Unsubscribe = () => void

type WmelonTagged = {
  constructor: { _wmelonTag?: string }
  experimentalSubscribe: (subscriber: (value: unknown) => void) => Unsubscribe
}

type ObservableLike = {
  observe: () => { subscribe: SubscribeFn }
}

type SubscribableLike = {
  subscribe: SubscribeFn
}

type SubscribeFn = (
  onNext: (value: unknown) => void,
  onError: (error: Error) => void,
  onComplete: () => void,
) => { unsubscribe: () => void }

function getWmelonTag(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const tagged = value as Partial<WmelonTagged>
  return tagged.constructor?._wmelonTag
}

function subscribe(
  value: unknown,
  onNext: (next: unknown) => void,
  onError: (error: Error) => void,
  onComplete: () => void,
): Unsubscribe {
  const wmelonTag = getWmelonTag(value)
  if (wmelonTag === 'model') {
    onNext(value)
    const model = value as WmelonTagged
    return model.experimentalSubscribe((isDeleted) => {
      if (isDeleted) {
        onComplete()
      } else {
        onNext(value)
      }
    })
  } else if (wmelonTag === 'query') {
    const query = value as WmelonTagged
    return query.experimentalSubscribe(onNext)
  } else if (value && typeof value === 'object' && typeof (value as ObservableLike).observe === 'function') {
    const subscription = (value as ObservableLike).observe().subscribe(onNext, onError, onComplete)
    return () => subscription.unsubscribe()
  } else if (value && typeof value === 'object' && typeof (value as SubscribableLike).subscribe === 'function') {
    const subscription = (value as SubscribableLike).subscribe(onNext, onError, onComplete)
    return () => subscription.unsubscribe()
  }

  // eslint-disable-next-line no-console
  console.error(
    `[withObservable] Value passed to withObservables doesn't appear to be observable:`,
    value,
  )
  throw new Error(
    `[withObservable] Value passed to withObservables doesn't appear to be observable. See console for details`,
  )
}

function identicalArrays<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let i = 0, len = left.length; i < len; i += 1) {
    if (left[i] !== right[i]) {
      return false
    }
  }

  return true
}

function getTriggeringProps<PropsInput extends object>(
  props: PropsInput,
  propNames: TriggerProps<PropsInput>,
): unknown[] {
  if (!propNames) {
    return []
  }

  return propNames.map((name) => props[name])
}

const hasOwn = (obj: object, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

type ComponentState = {
  isFetching: boolean
  values: Record<string, unknown>
  error: Error | null
  triggeredFromProps: unknown[]
}

// TODO: This is probably not going to be 100% safe to use under React async mode
// Do more research
class WithObservablesComponent<PropsInput extends object> extends Component<
  PropsInput,
  ComponentState
> {
  BaseComponent: ComponentType<object>

  triggerProps: TriggerProps<PropsInput>

  getObservables: GetObservables<PropsInput, Record<string, unknown>>

  _unsubscribe: Unsubscribe | null = null

  _prefetchTimeoutCanceled: boolean = false

  _exitedConstructor = false

  constructor(
    props: PropsInput,
    BaseComponent: ComponentType<object>,
    getObservables: GetObservables<PropsInput, object>,
    triggerProps: TriggerProps<PropsInput>,
  ) {
    super(props)
    this.BaseComponent = BaseComponent
    this.triggerProps = triggerProps
    this.getObservables = getObservables as GetObservables<PropsInput, Record<string, unknown>>
    this.state = {
      isFetching: true,
      values: {},
      error: null,
      triggeredFromProps: getTriggeringProps(props, triggerProps),
    }

    // The recommended React practice is to subscribe to async sources on `didMount`
    // Unfortunately, that's slow, because we have an unnecessary empty render even if we
    // can get first values before render.
    //
    // So we're subscribing in constructor, but that's dangerous. We have no guarantee that
    // the component will actually be mounted (and therefore that `willUnmount` will be called
    // to safely unsubscribe). So we're setting a safety timeout to avoid leaking memory.
    // If component is not mounted before timeout, we'll unsubscribe just to be sure.
    // (If component is mounted after all, just super slow, we'll subscribe again on didMount)
    this.subscribeWithoutSettingState(this.props)

    scheduleForCleanup(() => {
      if (!this._prefetchTimeoutCanceled) {
        // eslint-disable-next-line no-console
        console.warn(`[withObservables] Unsubscribing from source. Leaky component!`)
        this.unsubscribe()
      }
    })

    this._exitedConstructor = true
  }

  componentDidMount(): void {
    this.cancelPrefetchTimeout()

    if (!this._unsubscribe) {
      // eslint-disable-next-line no-console
      console.warn(
        `[withObservables] Component mounted but no subscription present. Slow component (timed out) or a bug! Re-subscribing...`,
      )

      const newTriggeringProps = getTriggeringProps(this.props, this.triggerProps)
      this.subscribe(this.props, newTriggeringProps)
    }
  }

  // eslint-disable-next-line
  UNSAFE_componentWillReceiveProps(nextProps: PropsInput): void {
    const { triggeredFromProps } = this.state
    const newTriggeringProps = getTriggeringProps(nextProps, this.triggerProps)

    if (!identicalArrays(triggeredFromProps, newTriggeringProps)) {
      this.subscribe(nextProps, newTriggeringProps)
    }
  }

  subscribe(props: PropsInput, triggeredFromProps: unknown[]): void {
    this.setState({
      isFetching: true,
      values: {},
      triggeredFromProps,
    })

    this.subscribeWithoutSettingState(props)
  }

  // NOTE: This is a hand-coded equivalent of Rx combineLatestObject
  subscribeWithoutSettingState(props: PropsInput): void {
    this.unsubscribe()

    const observablesObject = this.getObservables(props)

    let subscriptions: Unsubscribe[] = []
    let isUnsubscribed = false
    const unsubscribe = () => {
      isUnsubscribed = true
      subscriptions.forEach((_unsubscribe) => _unsubscribe())
      subscriptions = []
    }

    const values: Record<string, unknown> = {}
    let valueCount = 0

    const keys = Object.keys(observablesObject)
    const keyCount = keys.length
    keys.forEach((key) => {
      if (isUnsubscribed) {
        return
      }

      const subscribable = observablesObject[key]
      subscriptions.push(
        subscribe(
          subscribable,
          (value) => {
            const isFirstEmission = !hasOwn(values, key)
            if (isFirstEmission) {
              valueCount += 1
            }

            values[key] = value

            const hasAllValues = valueCount === keyCount
            if (hasAllValues && !isUnsubscribed) {
              this.withObservablesOnChange(values)
            }
          },
          (error) => {
            unsubscribe()
            this.withObservablesOnError(error)
          },
          () => {
            // TODO: Should we do anything on completion?
          },
        ),
      )
    })

    if (process.env.NODE_ENV !== 'production') {
      const renderedTriggerProps = this.triggerProps ? this.triggerProps.join(',') : 'null'
      const renderedKeys = keys.join(', ')
      ;(this.constructor as { displayName?: string }).displayName =
        `withObservables[${renderedTriggerProps}] { ${renderedKeys} }`
    }

    this._unsubscribe = unsubscribe
  }

  // DO NOT rename (we want on call stack as debugging help)
  withObservablesOnChange(values: Record<string, unknown>): void {
    if (this._exitedConstructor) {
      this.setState({
        values,
        isFetching: false,
      })
    } else {
      // Source has called with first values synchronously while we're still in the
      // constructor. Here, `this.setState` does not work and we must mutate this.state
      // directly
      const state = this.state as ComponentState
      state.values = values
      state.isFetching = false
    }
  }

  // DO NOT rename (we want on call stack as debugging help)
  withObservablesOnError(error: Error): void {
    if (this._exitedConstructor) {
      this.setState({
        error,
        isFetching: false,
      })
    } else {
      const state = this.state as ComponentState
      state.error = error
      state.isFetching = false
    }
  }

  unsubscribe(): void {
    this._unsubscribe && this._unsubscribe()
    this.cancelPrefetchTimeout()
  }

  cancelPrefetchTimeout(): void {
    this._prefetchTimeoutCanceled = true
  }

  shouldComponentUpdate(_nextProps: PropsInput, nextState: ComponentState): boolean {
    // If one of the triggering props change but we don't yet have first values from the new
    // observable, *don't* render anything!
    return !nextState.isFetching
  }

  componentWillUnmount(): void {
    this.unsubscribe()
  }

  render(): JSX.Element | null {
    const { isFetching, values, error } = this.state

    if (isFetching) {
      return null
    } else if (error) {
      // rethrow error found in Rx composition as to unify withObservables errors with other React errors
      // the responsibility for handling errors is on the user (by using an Error Boundary)
      throw error
    } else {
      return createElement(this.BaseComponent, Object.assign({}, this.props, values))
    }
  }
}

/**
 *
 * Injects new props to a component with values from the passed Observables
 *
 * Every time one of the `triggerProps` changes, `getObservables()` is called
 * and the returned Observables are subscribed to.
 *
 * Every time one of the Observables emits a new value, the matching inner prop is updated.
 *
 * You can return multiple Observables in the function. You can also return arbitrary objects that have
 * an `observe()` function that returns an Observable.
 *
 * The inner component will not render until all supplied Observables return their first values.
 * If `triggerProps` change, renders will also be paused until the new Observables emit first values.
 *
 * If you only want to subscribe to Observables once (the Observables don't depend on outer props),
 * pass `null` to `triggerProps`.
 *
 * Errors are re-thrown in render(). Use React Error Boundary to catch them.
 *
 * Example use:
 * ```js
 *   withObservables(['task'], ({ task }) => ({
 *     task: task,
 *     comments: task.comments.observe()
 *   }))
 * ```
 */
const withObservables = <InputProps extends object, ObservableProps extends object>(
  triggerProps: TriggerProps<InputProps>,
  getObservables: GetObservables<InputProps, ObservableProps>,
): InferableComponentEnhancer<ExtractedObservables<ObservableProps>, InputProps> => {
  return ((BaseComponent: ComponentType<object>) => {
    class ConcreteWithObservablesComponent extends WithObservablesComponent<InputProps> {
      static displayName: string | undefined

      constructor(props: InputProps) {
        super(props, BaseComponent, getObservables, triggerProps)
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      const renderedTriggerProps = triggerProps ? triggerProps.join(',') : 'null'
      ConcreteWithObservablesComponent.displayName = `withObservables[${renderedTriggerProps}]`
    }

    return hoistNonReactStatics(ConcreteWithObservablesComponent, BaseComponent)
  }) as unknown as InferableComponentEnhancer<ExtractedObservables<ObservableProps>, InputProps>
}

export default withObservables
