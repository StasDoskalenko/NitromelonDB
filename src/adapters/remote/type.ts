import type { ResultCallback } from '../../utils/fp/Result'
import type { AppSchema } from '../../Schema'
import type { SchemaMigrations } from '../../Schema/migrations'

export type RemoteHandler = <T>(op: string, args: unknown[], callback: ResultCallback<T>) => void

export type RemoteAdapterOptions = {
  schema: AppSchema
  migrations?: SchemaMigrations | undefined
  handler: RemoteHandler
}
