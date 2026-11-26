/**
 * @jest-environment jsdom
 */

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import useEncryption from './useEncryption'
import DatabaseProvider from './DatabaseProvider'
import { appSchema, tableSchema } from '../Schema'
import Database from '../Database'
import LokiJSAdapter from '../adapters/lokijs'
import SQLiteAdapter from '../adapters/sqlite'
import * as makeDispatcherModule from '../adapters/sqlite/makeDispatcher'
import { fake, installFakeNatives } from '../adapters/sqlite/__tests__/fakeEncryptionNative'

jest.mock('../adapters/sqlite/makeDispatcher', () => ({
  makeDispatcher: jest.fn(),
  getDispatcherType: jest.fn(() => 'nitro'),
  isEncryptionAvailable: jest.fn(() => true),
  getDatabaseEncryptionState: jest.fn(),
  encryptionUnavailableHint: jest.fn(() => ''),
}))

const schema = appSchema({
  version: 1,
  tables: [tableSchema({ name: 'notes', columns: [{ name: 'title', type: 'string' }] })],
})

const makeDatabase = (encryption) =>
  new Database({
    adapter: new SQLiteAdapter({ dbName: 'secret', schema, ...(encryption ? { encryption } : {}) }),
    modelClasses: [],
  })

beforeEach(() => {
  installFakeNatives(makeDispatcherModule)
})

afterEach(() => {
  jest.useRealTimers()
})

describe('useEncryption', () => {
  it('reads the state, and follows an encrypt it starts, with progress', async () => {
    fake.files.set('secret', { key: null, version: 1 })
    const database = makeDatabase({ passphrase: 'k1', ifUnencrypted: 'open' })
    const { result } = renderHook(() => useEncryption(database))
    expect(result.current.state).toBe('loading')
    await waitFor(() => expect(result.current.state).toBe('unencrypted'))
    expect(result.current.operation).toBe(null)
    expect(result.current.progress).toBe(null)

    jest.useFakeTimers()
    const native = fake.natives[0]
    native.rekeyDelay = 1000
    native.progressSteps = [0.25, 0.6]
    let done
    act(() => {
      done = result.current.encrypt('k1')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.operation).toBe('encrypt')
    expect(result.current.progress).toBe(0)

    act(() => {
      jest.advanceTimersByTime(200)
    })
    expect(result.current.progress).toBe(0.25)
    act(() => {
      jest.advanceTimersByTime(200)
    })
    expect(result.current.progress).toBe(0.6)

    await act(async () => {
      jest.advanceTimersByTime(1000)
      await done
    })
    expect(result.current.state).toBe('encrypted')
    expect(result.current.operation).toBe(null)
    expect(result.current.progress).toBe(null)
    expect(fake.files.get('secret').key).toBe('k1')
  })

  it('follows operations started elsewhere, and uses the database from DatabaseProvider', async () => {
    const database = makeDatabase({ passphrase: 'k1' })
    const wrapper = ({ children }) => (
      <DatabaseProvider database={database}>{children}</DatabaseProvider>
    )
    const { result } = renderHook(() => useEncryption(), { wrapper })
    await waitFor(() => expect(result.current.state).toBe('encrypted'))

    await act(async () => {
      await database.write(() => database.unsafe_DecryptDB())
    })
    expect(result.current.state).toBe('unencrypted')
    expect(fake.files.get('secret').key).toBe(null)
  })

  it('sets error and rejects when it fails, and the state stays', async () => {
    const database = makeDatabase({ passphrase: 'k1' })
    const { result } = renderHook(() => useEncryption(database))
    await waitFor(() => expect(result.current.state).toBe('encrypted'))
    fake.natives[0].failRekey = true

    let rejection
    await act(async () => {
      rejection = await result.current.decrypt().catch((error) => error)
    })
    expect(rejection).toMatchObject({ code: 'rekey_failed' })
    expect(result.current.error).toBe(rejection)
    expect(result.current.state).toBe('encrypted')
    expect(result.current.operation).toBe(null)

    // Cleared when the next one starts
    fake.natives[0].failRekey = false
    await act(async () => {
      await result.current.encrypt('k2')
    })
    expect(result.current.error).toBe(null)
    expect(fake.files.get('secret').key).toBe('k2')
  })

  it("is 'unavailable' without the encryption option, and with LokiJS", async () => {
    const plain = makeDatabase(undefined)
    const { result } = renderHook(() => useEncryption(plain))
    expect(result.current.state).toBe('unavailable')

    const loki = new Database({
      adapter: new LokiJSAdapter({ schema, useWebWorker: false, useIncrementalIndexedDB: false }),
      modelClasses: [],
    })
    const { result: lokiResult } = renderHook(() => useEncryption(loki))
    expect(lokiResult.current.state).toBe('unavailable')
    let rejection
    await act(async () => {
      rejection = await lokiResult.current.encrypt('k1').catch((error) => error)
    })
    expect(rejection.message).toMatch(/doesn't support encryption/)
    expect(lokiResult.current.error).toBe(rejection)
  })

  it('stops following when unmounted', async () => {
    const database = makeDatabase({ passphrase: 'k1' })
    const { result, unmount } = renderHook(() => useEncryption(database))
    await waitFor(() => expect(result.current.state).toBe('encrypted'))
    expect(database.adapter.underlyingAdapter._encryptionListeners.size).toBe(1)
    unmount()
    expect(database.adapter.underlyingAdapter._encryptionListeners.size).toBe(0)
  })
})
