import {
  type Observable,
  of as of$,
  map as map$,
  switchMap,
  distinctUntilChanged,
} from '../utils/rx'

import type Relation from './index'
import type Model from '../Model'
import type { RecordId } from '../Model'

const getImmutableObservable = <T extends Model | null>(
  relation: Relation<T>,
): Observable<T> =>
  relation._model.collections
    .get(relation._relationTableName)
    .findAndObserve(relation.id as RecordId) as Observable<T>

const getObservable = <T extends Model | null>(relation: Relation<T>): Observable<T> =>
  relation._model.observe().pipe(
    map$((model) => model._getRaw(relation._columnName)),
    distinctUntilChanged(),
    switchMap((id) =>
      id
        ? relation._model.collections
            .get(relation._relationTableName)
            .findAndObserve(id as RecordId)
        : of$(null),
    ),
  ) as Observable<T>

// eslint-disable-next-line
export const createObservable = <T extends Model | null>(
  relation: Relation<T>,
): Observable<T> => (relation._isImmutable ? getImmutableObservable(relation) : getObservable(relation))
