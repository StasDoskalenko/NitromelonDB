import encodeDestroyMatchingMutation from './index'

describe('encodeDestroyMatchingMutation', () => {
  const sql = 'select "tasks".* from "tasks" where "tasks"."name" is ?'

  it('wraps the query as a derived table when there is a predicate', () => {
    expect(encodeDestroyMatchingMutation('tasks', sql, true, false)).toBe(
      `delete from "tasks" where "id" in (select "id" from (${sql}))`,
    )
    expect(encodeDestroyMatchingMutation('tasks', sql, false, false)).toBe(
      `update "tasks" set "_status" = 'deleted' where "id" in (select "id" from (${sql}))`,
    )
  })

  it('skips straight to a bare statement when unconditional', () => {
    expect(encodeDestroyMatchingMutation('tasks', sql, true, true)).toBe('delete from "tasks"')
    expect(encodeDestroyMatchingMutation('tasks', sql, false, true)).toBe(
      `update "tasks" set "_status" = 'deleted'`,
    )
  })
})
