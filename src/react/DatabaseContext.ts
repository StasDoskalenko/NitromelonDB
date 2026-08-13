import React, { type Context } from 'react'
import type Database from '../Database'

const DatabaseContext: Context<Database> = React.createContext(undefined as unknown as Database)
const { Provider, Consumer } = DatabaseContext

export { Consumer as DatabaseConsumer, Provider }

export default DatabaseContext
