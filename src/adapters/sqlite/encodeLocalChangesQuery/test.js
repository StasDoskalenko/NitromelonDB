import encodeLocalChangesQueries, { TABLES_PER_QUERY } from './index'

const tableNames = (count) => Array.from({ length: count }, (_, i) => `table_${i}`)

describe('encodeLocalChangesQueries', () => {
  it('encodes one EXISTS check per table, joined into one compound select', () => {
    expect(encodeLocalChangesQueries(['tasks', 'projects'])).toEqual([
      `select 'tasks' as id where exists (select 1 from "tasks" where "_status" in ('created', 'updated', 'deleted'))` +
        ` union all ` +
        `select 'projects' as id where exists (select 1 from "projects" where "_status" in ('created', 'updated', 'deleted'))`,
    ])
  })

  it('stays under the compound-select limit', () => {
    const queries = encodeLocalChangesQueries(tableNames(TABLES_PER_QUERY * 2 + 50))
    expect(queries.map((sql) => sql.split(' union all ').length)).toEqual([
      TABLES_PER_QUERY,
      TABLES_PER_QUERY,
      50,
    ])
    expect(TABLES_PER_QUERY).toBeLessThan(500)
  })

  it('asks about every table exactly once', () => {
    const tables = tableNames(TABLES_PER_QUERY + 1)
    const asked = encodeLocalChangesQueries(tables)
      .join(' union all ')
      .match(/select '([^']+)' as id/g)
      .map((select) => select.split("'")[1])
    expect(asked).toEqual(tables)
  })

  it('encodes nothing for no tables', () => {
    expect(encodeLocalChangesQueries([])).toEqual([])
  })

  it('escapes the table name literal', () => {
    // Table names are validated elsewhere; the literal is escaped regardless
    expect(encodeLocalChangesQueries(["it's"])[0]).toMatch(/^select 'it''s' as id /)
  })
})
