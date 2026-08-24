/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import useQuery from './useQuery'
import { mockDatabase } from '../__tests__/testModels'

describe('useQuery', () => {
  let database
  let tasks
  beforeEach(() => {
    ;({ database, tasks } = mockDatabase())
  })

  it('returns matching records and re-renders when the set changes', async () => {
    const query = tasks.query()
    const { result } = renderHook(() => useQuery(query))

    expect(result.current).toEqual([])

    let taskA
    await act(async () => {
      taskA = await database.write(() => tasks.create((t) => (t.name = 'A')))
    })
    expect(result.current.map((t) => t.name)).toEqual(['A'])

    await act(async () => {
      await database.write(() => tasks.create((t) => (t.name = 'B')))
    })
    expect(result.current.map((t) => t.name).sort()).toEqual(['A', 'B'])

    await act(async () => {
      await database.write(() => taskA.destroyPermanently())
    })
    expect(result.current.map((t) => t.name)).toEqual(['B'])
  })

  it('does not re-render on unrelated field changes without columnNames', async () => {
    let task
    await act(async () => {
      task = await database.write(() => tasks.create((t) => (t.name = 'A')))
    })

    const query = tasks.query()
    const { result } = renderHook(() => useQuery(query))
    const firstArray = result.current
    expect(firstArray.map((t) => t.name)).toEqual(['A'])

    await act(async () => {
      await database.write(() => task.update((t) => (t.name = 'A renamed')))
    })

    // Same matching set, so the same array reference — but the record inside
    // it is the same mutated instance, so reading .name off it still sees
    // the update.
    expect(result.current).toBe(firstArray)
    expect(result.current[0].name).toBe('A renamed')
  })

  it('re-renders on tracked column changes with columnNames', async () => {
    let task
    await act(async () => {
      task = await database.write(() => tasks.create((t) => (t.name = 'A')))
    })

    const query = tasks.query()
    const { result } = renderHook(() => useQuery(query, ['name']))
    const firstArray = result.current
    expect(firstArray.map((t) => t.name)).toEqual(['A'])

    await act(async () => {
      await database.write(() => task.update((t) => (t.name = 'A renamed')))
    })

    expect(result.current).not.toBe(firstArray)
    expect(result.current.map((t) => t.name)).toEqual(['A renamed'])
  })

  it('returns an empty array for null/undefined without subscribing', () => {
    const { result } = renderHook(({ query }) => useQuery(query), {
      initialProps: { query: null },
    })
    expect(result.current).toEqual([])
  })
})
