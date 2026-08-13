import type { Observable, ConnectableObservable } from '../utils/rx'
import invariant from '../utils/common/invariant'
import publishReplayLatestWhileConnected from '../utils/rx/publishReplayLatestWhileConnected'
import lazy from '../decorators/lazy'

import type Model from '../Model'
import type { RecordId } from '../Model'
import type { ColumnName, TableName } from '../Schema'

import { createObservable } from './helpers'

export type RelationId<T> = T extends Model ? RecordId : RecordId | null

export type Options = {
  isImmutable: boolean
}

// Defines a one-to-one relation between two Models (two tables in db)
// Do not create this object directly! Use `relation` or `immutableRelation` decorators instead
export default class Relation<T extends Model | null = Model> {
  // Used by withObservables to differentiate between object types
  static _wmelonTag: string = 'relation'

  _model: Model

  _columnName: ColumnName

  _relationTableName: TableName<NonNullable<T>>

  _isImmutable: boolean

  @lazy
  _cachedObservable: Observable<T> = (
    createObservable(this).pipe(
      publishReplayLatestWhileConnected,
    ) as ConnectableObservable<T>
  ).refCount()

  constructor(
    model: Model,
    relationTableName: TableName<NonNullable<T>>,
    columnName: ColumnName,
    options: Options,
  ) {
    this._model = model
    this._relationTableName = relationTableName
    this._columnName = columnName
    this._isImmutable = options.isImmutable
  }

  get id(): RelationId<T> {
    return this._model._getRaw(this._columnName) as RelationId<T>
  }

  set id(newId: RelationId<T>) {
    if (this._isImmutable) {
      invariant(
        this._model._preparedState === 'create',
        `Cannot change property marked as @immutableRelation ${
          Object.getPrototypeOf(this._model).constructor.name
        } - ${this._columnName}`,
      )
    }

    this._model._setRaw(this._columnName, newId || null)
  }

  fetch(): Promise<T> {
    const { id } = this
    if (id) {
      return this._model.collections.get(this._relationTableName).find(id) as Promise<T>
    }

    return Promise.resolve(null as T)
  }

  then<U>(
    onFulfill?: (value: T) => Promise<U> | U,
    onReject?: (error: unknown) => Promise<U> | U,
  ): Promise<U> {
    return this.fetch().then(onFulfill, onReject)
  }

  set(record: T): void {
    this.id = (record?.id ?? null) as RelationId<T>
  }

  observe(): Observable<T> {
    return this._cachedObservable
  }
}
