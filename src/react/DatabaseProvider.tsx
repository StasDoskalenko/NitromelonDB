import React, { type ReactNode, type ReactElement } from 'react'
import Database from '../Database'
import { Provider } from './DatabaseContext'

export type Props = {
  database: Database
  children: ReactNode
}

/**
 * Database provider to create the database context
 * to allow child components to consume the database without prop drilling
 */
function DatabaseProvider({ children, database }: Props): ReactElement {
  if (!(database instanceof Database)) {
    throw new Error('You must supply a valid database prop to the DatabaseProvider')
  }
  return <Provider value={database}>{children}</Provider>
}

export { default as withDatabase } from './withDatabase'
export { default as DatabaseContext, DatabaseConsumer } from './DatabaseContext'
export default DatabaseProvider
