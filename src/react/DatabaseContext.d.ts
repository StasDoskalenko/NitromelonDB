import type { Context, Consumer, Provider as ReactProvider } from 'react'
import type Database from '../Database'

declare const DatabaseContext: Context<Database>
export const DatabaseConsumer: Consumer<Database>
export const Provider: ReactProvider<Database>
export default DatabaseContext
