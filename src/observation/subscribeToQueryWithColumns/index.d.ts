import type { Unsubscribe } from '../../utils/subscriptions'

import type Query from '../../Query'
import type Model from '../../Model'
import type { ColumnName } from '../../Schema'

export default function subscribeToQueryWithColumns<Record extends Model>(
  query: Query<Record>,
  columnNames: ColumnName[],
  subscriber: (records: Record[]) => void,
): Unsubscribe
