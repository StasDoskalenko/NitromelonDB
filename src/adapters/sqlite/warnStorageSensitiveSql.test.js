import { logger } from '../../utils/common'
import * as Q from '../../QueryDescription'
import { appSchema, tableSchema } from '../../Schema'
import { warnStorageSensitiveSql, warnStorageSensitiveQuery } from './warnStorageSensitiveSql'

const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'orders',
      columns: [
        { name: 'total', type: 'number' },
        { name: 'note', type: 'string' },
      ],
    }),
  ],
})

const query = (...clauses) => ({
  table: 'orders',
  description: Q.buildQueryDescription(clauses),
  associations: [],
})

describe('warnStorageSensitiveSql', () => {
  let warn
  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  const warns = (sql) => {
    warn.mockClear()
    warnStorageSensitiveSql(sql)
    return warn.mock.calls.length > 0
  }

  it('warns about SQL that can see how a whole number is stored', () => {
    expect(warns('select sum(total) / count(*) as average from orders')).toBe(true)
    expect(warns("select note || ' ' || total from orders where 1")).toBe(true)
    expect(warns('select cast(total as text) from orders')).toBe(true)
    expect(warns("select printf('%d', total) from orders")).toBe(true)
    expect(warns('select typeof(total) from orders')).toBe(true)
  })

  it("doesn't warn about SQL that can't, or about / and || in strings and comments", () => {
    expect(warns('select * from orders where total > 10 order by total desc')).toBe(false)
    expect(warns("select * from orders where note = 'a/b || c' -- 1/2\n and 1 /* 3/4 */")).toBe(
      false,
    )
    expect(warns('select avg(total), sum(total) * 1.0 from orders')).toBe(false)
  })

  it('warns once per query', () => {
    expect(warns('select 1 / 2 as once')).toBe(true)
    expect(warns('select 1 / 2 as once')).toBe(false)
  })

  it('checks raw SQL inside queries, and text matches on number columns', () => {
    const check = (...clauses) => {
      warn.mockClear()
      warnStorageSensitiveQuery(query(...clauses), schema)
      return warn.mock.calls.length > 0
    }
    expect(check(Q.unsafeSqlQuery('select total / 3 as third from orders'))).toBe(true)
    expect(check(Q.where('note', 'x'), Q.or(Q.unsafeSqlExpr('total / 2 > 1')))).toBe(true)
    expect(check(Q.sortBy(Q.unsafeSqlExpr('total || note'), Q.asc))).toBe(true)
    expect(check(Q.where('total', Q.like('4%')))).toBe(true)
    expect(check(Q.where('note', Q.like('4%')))).toBe(false)
    expect(check(Q.where('total', Q.gt(3)), Q.sortBy('total'))).toBe(false)
  })
})
