import React, { type ComponentType, type ReactElement } from 'react'
import hoistNonReactStatics, { type NonReactStatics } from 'hoist-non-react-statics'
import type Database from '../Database'
import { DatabaseConsumer } from './DatabaseContext'

type WithDatabaseProps<T> = T & {
  database: Database
}

export default function withDatabase<P extends object>(
  Component: ComponentType<WithDatabaseProps<P>>,
): ComponentType<P> & NonReactStatics<typeof Component> {
  function DatabaseComponent(props: P): ReactElement {
    return (
      <DatabaseConsumer>
        {(database: Database) => <Component {...props} database={database} />}
      </DatabaseConsumer>
    )
  }

  return hoistNonReactStatics(DatabaseComponent, Component)
}
