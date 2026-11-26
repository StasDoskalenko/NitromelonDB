// SQLiteAdapter's `encryption` option, against a fake native dispatcher (fakeEncryptionNative.js)

import { appSchema, tableSchema } from '../../../Schema'
import Database from '../../../Database'
import LokiJSAdapter from '../../lokijs'
import SQLiteAdapter from '../index'
import * as makeDispatcherModule from '../makeDispatcher'
import { fake, installFakeNatives } from './fakeEncryptionNative'

jest.mock('../makeDispatcher', () => ({
  makeDispatcher: jest.fn(),
  getDispatcherType: jest.fn(() => 'nitro'),
  isEncryptionAvailable: jest.fn(() => true),
  getDatabaseEncryptionState: jest.fn(),
  encryptionUnavailableHint: jest.fn(() => 'Install better-sqlite3-multiple-ciphers.'),
}))

const schema = appSchema({
  version: 1,
  tables: [tableSchema({ name: 'notes', columns: [{ name: 'title', type: 'string' }] })],
})

let files
let natives

beforeEach(() => {
  installFakeNatives(makeDispatcherModule)
  ;({ files, natives } = fake)
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

  it('is rejected on web, and on Node without the cipher package, instead of being ignored', () => {
    makeDispatcherModule.getDispatcherType.mockReturnValue('wa-sqlite')
    expect(() => makeAdapter({ passphrase: 'k1' })).toThrow(/not with the wa-sqlite/)
    makeDispatcherModule.getDispatcherType.mockReturnValue('asynchronous')
    expect(() => makeAdapter({ passphrase: 'k1' })).not.toThrow()
    makeDispatcherModule.isEncryptionAvailable.mockReturnValue(false)
    expect(() => makeAdapter({ passphrase: 'k1' })).toThrow(
      /better-sqlite3 has no encryption.*Install better-sqlite3-multiple-ciphers/,
    )
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

describe('SQLiteAdapter encryption progress and listeners', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('polls native progress while the key changes, and reports when it moved', async () => {
    jest.useFakeTimers()
    const onProgress = jest.fn()
    const adapter = makeAdapter({ passphrase: 'k1', events: { onProgress } })
    await adapter.initializingPromise
    const native = natives[0]
    native.rekeyDelay = 1000
    // -1 until native has started; 0.305 moved less than 0.01 from 0.3, so it's skipped
    native.progressSteps = [-1, 0.1, 0.3, 0.305, 0.8]

    const done = changeKey(adapter, 'k2')
    jest.advanceTimersByTime(1000)
    await done
    expect(onProgress.mock.calls.map(([info]) => info)).toEqual([
      { operation: 'rekey', progress: 0.1 },
      { operation: 'rekey', progress: 0.3 },
      { operation: 'rekey', progress: 0.8 },
    ])

    // Stops polling when it's done
    onProgress.mockClear()
    jest.advanceTimersByTime(1000)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it("doesn't poll on Node, where SQLite runs on the JS thread", async () => {
    jest.useFakeTimers()
    makeDispatcherModule.getDispatcherType.mockReturnValue('asynchronous')
    const onProgress = jest.fn()
    const adapter = makeAdapter({ passphrase: 'k1', events: { onProgress } })
    await adapter.initializingPromise
    natives[0].rekeyDelay = 1000
    natives[0].progressSteps = [0.5]
    const done = changeKey(adapter, 'k2')
    jest.advanceTimersByTime(1000)
    await done
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('calls subscribers after encryption.events, until they unsubscribe', async () => {
    const order = []
    const adapter = makeAdapter({
      passphrase: 'k1',
      events: { onStart: () => order.push('options'), onSuccess: () => order.push('options done') },
    })
    await adapter.initializingPromise
    expect(adapter.encryptionEnabled).toBe(true)
    const unsubscribe = adapter.subscribeToEncryptionEvents({
      onStart: (info) => order.push(`subscriber ${info.operation}`),
      onSuccess: (info) => order.push(`subscriber done ${info.operation}`),
    })
    await changeKey(adapter, 'k2')
    expect(order).toEqual(['options', 'subscriber rekey', 'options done', 'subscriber done rekey'])

    unsubscribe()
    order.length = 0
    await changeKey(adapter, '')
    expect(order).toEqual(['options', 'options done'])
  })

  it("a listener that throws doesn't stop the others, or the re-key", async () => {
    const onSuccess = jest.fn()
    const onError = jest.fn()
    const adapter = makeAdapter({
      passphrase: 'k1',
      events: {
        onStart: () => {
          throw new Error('listener bug')
        },
        onSuccess: () => {
          throw new Error('listener bug')
        },
      },
    })
    await adapter.initializingPromise
    adapter.subscribeToEncryptionEvents({ onSuccess, onError })
    await changeKey(adapter, 'k2')
    expect(files.get('secret').key).toBe('k2')
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ operation: 'rekey' }))

    natives[0].failRekey = true
    await expect(changeKey(adapter, 'k3')).rejects.toMatchObject({ code: 'rekey_failed' })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'rekey_failed' }))
  })

  it('is not enabled without the encryption option', () => {
    expect(makeAdapter(undefined).encryptionEnabled).toBe(false)
  })
})

describe('SQLiteAdapter encryption.plaintextHeader', () => {
  it('passes it to native, and refuses it on Node and when it is not a boolean', () => {
    makeAdapter({ passphrase: 'k1', plaintextHeader: true })
    expect(natives[0].options.plaintextHeader).toBe(true)
    makeAdapter({ passphrase: 'k1' })
    expect(natives[1].options.plaintextHeader).toBe(undefined)

    expect(() => makeAdapter({ passphrase: 'k1', plaintextHeader: 'yes' })).toThrow(
      /plaintextHeader must be true or false/,
    )
    makeDispatcherModule.getDispatcherType.mockReturnValue('asynchronous')
    expect(() => makeAdapter({ passphrase: 'k1', plaintextHeader: true })).toThrow(
      expect.objectContaining({ code: 'encryption_unavailable' }),
    )
  })

  it('re-keys an encrypted database into the layout asked for once it is set up, with events', async () => {
    files.set('secret', { key: 'k1', version: 1, header: false })
    const events = { onStart: jest.fn(), onSuccess: jest.fn() }
    const adapter = makeAdapter({ passphrase: 'k1', plaintextHeader: true, events })
    await adapter.initializingPromise
    // Calls made after setup wait for it
    const local = await new Promise((resolve) => adapter.getLocal('x', resolve))
    expect(local.value).toBe(null)
    expect(natives[0].log).toContain('changeEncryptionKey')
    expect(files.get('secret')).toMatchObject({ key: 'k1', header: true })
    expect(events.onStart).toHaveBeenCalledWith(expect.objectContaining({ operation: 'rekey' }))
    expect(events.onSuccess).toHaveBeenCalledWith(expect.objectContaining({ operation: 'rekey' }))
    expect(natives[0].log.indexOf('changeEncryptionKey')).toBeLessThan(
      natives[0].log.indexOf('getLocal'),
    )

    // And back when the option is turned off
    const plain = makeAdapter({ passphrase: 'k1' })
    await plain.initializingPromise
    await new Promise((resolve) => plain.getLocal('x', resolve))
    expect(files.get('secret')).toMatchObject({ key: 'k1', header: false })
  })

  it('leaves a database alone when its layout matches, or it is not encrypted', async () => {
    files.set('secret', { key: 'k1', version: 1, header: true })
    const adapter = makeAdapter({ passphrase: 'k1', plaintextHeader: true })
    await adapter.initializingPromise
    await new Promise((resolve) => adapter.getLocal('x', resolve))
    expect(natives[0].log).not.toContain('changeEncryptionKey')

    files.set('plain', { key: null, version: 1 })
    const plain = new SQLiteAdapter({
      dbName: 'plain',
      schema,
      encryption: { passphrase: 'k1', ifUnencrypted: 'open', plaintextHeader: true },
    })
    await plain.initializingPromise
    await new Promise((resolve) => plain.getLocal('x', resolve))
    expect(natives[1].log).not.toContain('changeEncryptionKey')
    expect(files.get('plain').key).toBe(null)
  })

  it('a new database is created with it, and encrypting writes it', async () => {
    const adapter = makeAdapter({ passphrase: 'k1', plaintextHeader: true })
    await adapter.initializingPromise
    expect(files.get('secret')).toMatchObject({ key: 'k1', header: true })

    files.set('plain', { key: null, version: 1 })
    const plain = new SQLiteAdapter({
      dbName: 'plain',
      schema,
      encryption: { passphrase: 'k1', ifUnencrypted: 'open', plaintextHeader: true },
    })
    await plain.initializingPromise
    await changeKey(plain, 'k1')
    expect(files.get('plain')).toMatchObject({ key: 'k1', header: true })
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
