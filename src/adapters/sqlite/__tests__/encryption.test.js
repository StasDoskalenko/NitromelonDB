// SQLiteAdapter's `encryption` option, against a fake native dispatcher that follows the rules of
// native/shared/SqliteEncryption.cpp (which `yarn test:native-unit` tests for real). Files are kept
// in `files` by name, so a second adapter "reopens" what the first one left.

import { appSchema, tableSchema } from '../../../Schema'
import Database from '../../../Database'
import LokiJSAdapter from '../../lokijs'
import SQLiteAdapter from '../index'
import * as makeDispatcherModule from '../makeDispatcher'

jest.mock('../makeDispatcher', () => ({
  makeDispatcher: jest.fn(),
  getDispatcherType: jest.fn(() => 'nitro'),
  isEncryptionAvailable: jest.fn(() => true),
  getDatabaseEncryptionState: jest.fn(),
}))

const schema = appSchema({
  version: 1,
  tables: [tableSchema({ name: 'notes', columns: [{ name: 'title', type: 'string' }] })],
})

let files
let natives

function codedError(code) {
  const error = new Error(`[${code}] fake native error`)
  error.code = code
  return error
}

function fakeNative(dbName, { passphrase = '', allowUnencrypted = false }) {
  let open = false
  let encrypted = false
  const native = {
    log: [],
    rekeyDelay: 5,
    failRekey: false,
    call(method, args, callback) {
      native.log.push(method)
      try {
        const file = files.get(dbName)
        if (!open && method !== 'changeEncryptionKey') {
          // what SqliteDb's constructor does
          if (!file) {
            files.set(dbName, { key: passphrase || null, version: 0 })
            encrypted = !!passphrase
          } else if (!passphrase) {
            if (file.key) throw codedError('encryption_key_required')
          } else if (!file.key) {
            if (!allowUnencrypted) throw codedError('database_not_encrypted')
          } else if (file.key !== passphrase) {
            throw codedError('encryption_key_invalid')
          } else {
            encrypted = true
          }
          open = true
        }
        const current = files.get(dbName)
        switch (method) {
          case 'initialize':
            callback({ value: { code: current.version === args[1] ? 'ok' : 'schema_needed' } })
            return
          case 'setUpWithSchema':
            current.version = args[2]
            callback({ value: undefined })
            return
          case 'isEncrypted':
            callback({ value: encrypted })
            return
          case 'unsafeQueryRaw':
            callback({ value: [{ pageCount: 3, byteSize: 12288 }] })
            return
          case 'changeEncryptionKey':
            // a native background thread
            setTimeout(() => {
              if (native.failRekey) {
                callback({ error: codedError('rekey_failed') })
                return
              }
              current.key = args[0] || null
              encrypted = !!args[0]
              callback({ value: undefined })
            }, native.rekeyDelay)
            return
          case 'count':
            callback({ value: 0 })
            return
          default:
            callback({ value: method === 'getLocal' ? null : [] })
        }
      } catch (error) {
        callback({ error })
      }
    },
  }
  return native
}

beforeEach(() => {
  files = new Map()
  natives = []
  makeDispatcherModule.isEncryptionAvailable.mockReturnValue(true)
  makeDispatcherModule.getDispatcherType.mockReturnValue('nitro')
  makeDispatcherModule.makeDispatcher.mockReset()
  makeDispatcherModule.makeDispatcher.mockImplementation((_type, _tag, dbName, options) => {
    const native = fakeNative(dbName, options)
    native.options = options
    natives.push(native)
    return native
  })
})

const makeAdapter = (encryption, extra = {}) =>
  new SQLiteAdapter({ dbName: 'secret', schema, ...extra, ...(encryption ? { encryption } : {}) })

const isEncrypted = (adapter) =>
  new Promise((resolve, reject) =>
    adapter.isEncrypted((result) => (result.error ? reject(result.error) : resolve(result.value))),
  )

const changeKey = (adapter, key) =>
  new Promise((resolve, reject) =>
    adapter.unsafeChangeEncryptionKey(key, (result) =>
      result.error ? reject(result.error) : resolve(),
    ),
  )

describe('SQLiteAdapter encryption', () => {
  it('passes the passphrase and ifUnencrypted to the native database', async () => {
    const adapter = makeAdapter({ passphrase: 'k1', ifUnencrypted: 'open' })
    await adapter.initializingPromise
    expect(natives[0].options).toMatchObject({ passphrase: 'k1', allowUnencrypted: true })
    expect(await isEncrypted(adapter)).toBe(true)
    expect(files.get('secret').key).toBe('k1')

    makeAdapter({ passphrase: 'k1' })
    expect(natives[1].options).toMatchObject({ passphrase: 'k1', allowUnencrypted: false })
  })

  it('without the option, is not encrypted and opens without a passphrase', async () => {
    const adapter = makeAdapter(undefined)
    await adapter.initializingPromise
    expect(natives[0].options.passphrase).toBeUndefined()
    expect(await isEncrypted(adapter)).toBe(false)
    await expect(changeKey(adapter, 'k')).rejects.toMatchObject({ code: 'encryption_unavailable' })
  })

  it('fails loudly on a build without the codec, instead of writing a plaintext database', () => {
    makeDispatcherModule.isEncryptionAvailable.mockReturnValue(false)
    let error
    try {
      makeAdapter({ passphrase: 'k1' })
    } catch (e) {
      error = e
    }
    expect(error.code).toBe('encryption_unavailable')
    expect(error.message).toMatch(/"nitromelondb": \{ "encryption": true \}/)
    expect(error.message).toMatch(/pod install/)
    expect(makeDispatcherModule.makeDispatcher).not.toHaveBeenCalled()
    expect(files.size).toBe(0)
  })

  it('is rejected on web and Node instead of being ignored', () => {
    makeDispatcherModule.getDispatcherType.mockReturnValue('wa-sqlite')
    expect(() => makeAdapter({ passphrase: 'k1' })).toThrow(/not with the wa-sqlite/)
    makeDispatcherModule.getDispatcherType.mockReturnValue('asynchronous')
    expect(() => makeAdapter({ passphrase: 'k1' })).toThrow(/web or Node/)
    expect(
      () => new LokiJSAdapter({ schema, encryption: { passphrase: 'k1' }, useWebWorker: false }),
    ).toThrow(/LokiJSAdapter does not support encryption/)
  })

  it('rejects an empty passphrase and a bad ifUnencrypted', () => {
    expect(() => makeAdapter({ passphrase: '' })).toThrow(/instead of a passphrase/)
    expect(() => makeAdapter({ passphrase: 'k', ifUnencrypted: 'encrypt' })).toThrow(
      /ifUnencrypted must be/,
    )
  })

  it('holds calls until an async passphrase arrives, and keeps their order', async () => {
    let resolveKey
    const adapter = makeAdapter({
      passphrase: () =>
        new Promise((resolve) => {
          resolveKey = resolve
        }),
    })
    const order = []
    adapter.getLocal('a', () => order.push('a'))
    adapter.getLocal('b', () => order.push('b'))
    expect(makeDispatcherModule.makeDispatcher).not.toHaveBeenCalled()
    expect(order).toEqual([])

    resolveKey('k1')
    await adapter.initializingPromise
    expect(natives[0].options.passphrase).toBe('k1')
    expect(natives[0].log.slice(0, 4)).toEqual([
      'initialize',
      'setUpWithSchema',
      'getLocal',
      'getLocal',
    ])
    expect(order).toEqual(['a', 'b'])
  })

  it.each([
    ['returns null', () => null],
    ['returns an empty string', async () => ''],
    [
      'throws',
      async () => {
        throw new Error('Keychain is locked')
      },
    ],
  ])('fails setup and every queued call when the passphrase function %s', async (_, passphrase) => {
    const onSetUpError = jest.fn()
    const adapter = makeAdapter({ passphrase }, { onSetUpError })
    const queued = new Promise((resolve) => adapter.getLocal('a', resolve))
    await expect(adapter.initializingPromise).rejects.toThrow(
      /Keychain is locked|instead of a passphrase/,
    )
    expect((await queued).error).toBeTruthy()
    // never opened without a key
    expect(makeDispatcherModule.makeDispatcher).not.toHaveBeenCalled()
    expect(files.size).toBe(0)
  })

  it.each([
    ['a wrong passphrase', { passphrase: 'wrong' }, 'k1', 'encryption_key_invalid'],
    ['no passphrase', undefined, 'k1', 'encryption_key_required'],
    ['a plaintext database', { passphrase: 'k1' }, null, 'database_not_encrypted'],
  ])('fails setup on %s without resetting the database', async (_, encryption, key, code) => {
    files.set('secret', { key, version: 1 })
    const adapter = makeAdapter(encryption)
    await expect(adapter.initializingPromise).rejects.toMatchObject({ code })
    expect(natives[0].log).not.toContain('setUpWithSchema')
    expect(files.get('secret')).toEqual({ key, version: 1 })

    // and unsafeResetDatabase() can't get past it either: the database never opens
    await expect(
      new Promise((resolve, reject) =>
        adapter.unsafeResetDatabase((result) => (result.error ? reject(result.error) : resolve())),
      ),
    ).rejects.toMatchObject({ code })
    expect(files.get('secret')).toEqual({ key, version: 1 })
  })

  it('opens a plaintext database with ifUnencrypted: open, and encrypts it', async () => {
    files.set('secret', { key: null, version: 1 })
    const events = { onStart: jest.fn(), onSuccess: jest.fn(), onError: jest.fn() }
    const adapter = makeAdapter({ passphrase: 'k1', ifUnencrypted: 'open', events })
    await adapter.initializingPromise
    expect(await isEncrypted(adapter)).toBe(false)

    await changeKey(adapter, 'k1')
    expect(files.get('secret').key).toBe('k1')
    expect(await isEncrypted(adapter)).toBe(true)
    expect(events.onStart).toHaveBeenCalledWith({
      operation: 'encrypt',
      pageCount: 3,
      byteSize: 12288,
    })
    expect(events.onSuccess).toHaveBeenCalledWith(expect.objectContaining({ operation: 'encrypt' }))
    expect(events.onError).not.toHaveBeenCalled()

    await changeKey(adapter, 'k2')
    expect(events.onStart).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'rekey' }))
    expect(files.get('secret').key).toBe('k2')

    await changeKey(adapter, '')
    expect(events.onStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: 'decrypt' }),
    )
    expect(files.get('secret').key).toBe(null)

    // decrypting a database that isn't encrypted does nothing
    events.onStart.mockClear()
    await changeKey(adapter, '')
    expect(events.onStart).not.toHaveBeenCalled()
  })

  it('holds calls made while the key changes, then runs them in order', async () => {
    const adapter = makeAdapter({ passphrase: 'k1' })
    await adapter.initializingPromise
    const native = natives[0]
    native.log.length = 0

    const done = changeKey(adapter, 'k2')
    const order = []
    adapter.getLocal('during', () => order.push('during'))
    expect(native.log).toEqual(['isEncrypted', 'unsafeQueryRaw', 'changeEncryptionKey'])
    expect(order).toEqual([])

    await done
    expect(native.log).toEqual(['isEncrypted', 'unsafeQueryRaw', 'changeEncryptionKey', 'getLocal'])
    expect(order).toEqual(['during'])
  })

  it('reports a failed re-key, and the database keeps working with the old key', async () => {
    const onError = jest.fn()
    const adapter = makeAdapter({ passphrase: 'k1', events: { onError } })
    await adapter.initializingPromise
    natives[0].failRekey = true

    await expect(changeKey(adapter, 'k2')).rejects.toMatchObject({ code: 'rekey_failed' })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'rekey_failed' }))
    expect(files.get('secret').key).toBe('k1')
    expect(await isEncrypted(adapter)).toBe(true)
  })

  it('testClone keeps the encryption option', async () => {
    const adapter = makeAdapter({ passphrase: 'k1' })
    await adapter.initializingPromise
    const clone = await adapter.testClone()
    expect(natives[1].options.passphrase).toBe('k1')
    expect(await isEncrypted(clone)).toBe(true)
  })

  it('exposes the build and file checks', async () => {
    makeDispatcherModule.getDatabaseEncryptionState.mockReturnValue('missing')
    expect(SQLiteAdapter.isEncryptionAvailable()).toBe(true)
    expect(await SQLiteAdapter.getDatabaseEncryptionState()).toBe('missing')
    expect(makeDispatcherModule.getDatabaseEncryptionState).toHaveBeenCalledWith('watermelon')
    await SQLiteAdapter.getDatabaseEncryptionState('other')
    expect(makeDispatcherModule.getDatabaseEncryptionState).toHaveBeenLastCalledWith('other')
  })
})

describe('Database encryption', () => {
  const makeDatabase = (encryption) =>
    new Database({ adapter: makeAdapter(encryption), modelClasses: [] })

  it('encrypts and decrypts from a writer only', async () => {
    files.set('secret', { key: null, version: 1 })
    const database = makeDatabase({ passphrase: 'k1', ifUnencrypted: 'open' })
    expect(await database.isDBEncrypted()).toBe(false)

    await expect(database.unsafe_EncryptDB('k1')).rejects.toThrow(/inside of a Writer/)
    await expect(database.unsafe_DecryptDB()).rejects.toThrow(/inside of a Writer/)
    await expect(database.write(() => database.unsafe_EncryptDB(''))).rejects.toThrow(
      /non-empty passphrase/,
    )

    await database.write(() => database.unsafe_EncryptDB('k1'))
    expect(await database.isDBEncrypted()).toBe(true)
    expect(files.get('secret').key).toBe('k1')

    await database.write(() => database.unsafe_DecryptDB())
    expect(await database.isDBEncrypted()).toBe(false)
    expect(files.get('secret').key).toBe(null)
  })

  it('says not encrypted, and refuses to encrypt, with an adapter without encryption', async () => {
    const database = new Database({
      adapter: new LokiJSAdapter({ schema, useWebWorker: false, useIncrementalIndexedDB: false }),
      modelClasses: [],
    })
    expect(await database.isDBEncrypted()).toBe(false)
    await expect(database.write(() => database.unsafe_EncryptDB('k1'))).rejects.toThrow(
      /doesn't support encryption/,
    )
  })
})
