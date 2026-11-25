// SQLiteAdapter's `encryption` option on Node, for real: better-sqlite3-multiple-ciphers (a
// devDependency) encrypts actual files in .tmp/, which these tests read back from disk. The same
// rules as natively (native/shared/SqliteEncryption.cpp, tested by `yarn test:native-unit`), so a
// database moves between Node and the apps.

import fs from 'fs'
import { appSchema, tableSchema } from '../../../../Schema'
import Database from '../../../../Database'
import SQLiteAdapter from '../../index'
import NodeDatabase from '../Database'
import DatabaseBridge from '../DatabaseBridge'
import { decryptedCopyPath } from '../encryption'

const schema = appSchema({
  version: 1,
  tables: [tableSchema({ name: 'notes', columns: [{ name: 'title', type: 'string' }] })],
})

let paths = []
let adapters = []

function tempPath() {
  if (!fs.existsSync('.tmp')) {
    fs.mkdirSync('.tmp')
  }
  const path = `${process.cwd()}/.tmp/encryption${Math.random()}.db`
  paths.push(path)
  return path
}

function makeAdapter(dbName, encryption) {
  const adapter = new SQLiteAdapter({ dbName, schema, ...(encryption ? { encryption } : {}) })
  adapters.push(adapter)
  return adapter
}

async function open(dbName, encryption) {
  const adapter = makeAdapter(dbName, encryption)
  await adapter.initializingPromise
  return new Database({ adapter, modelClasses: [] })
}

// Rejects with the setup error, if any
async function setUpError(dbName, encryption) {
  const adapter = makeAdapter(dbName, encryption)
  try {
    await adapter.initializingPromise
    await new Promise((resolve, reject) =>
      adapter.getLocal('x', (result) => (result.error ? reject(result.error) : resolve())),
    )
  } catch (error) {
    return error
  }
  return null
}

const header = (path) => fs.readFileSync(path).subarray(0, 16).toString('latin1')
const isPlain = (path) => header(path) === 'SQLite format 3\0'
const fileContains = (path, text) =>
  ['', '-wal', '-journal'].some(
    (suffix) => fs.existsSync(path + suffix) && fs.readFileSync(path + suffix).includes(text),
  )

async function writeNote(database, title) {
  await database.write(() => database.adapter.batch([['create', 'notes', { id: title, title }]]))
}

// Straight to the connection, past SQLiteAdapter's query checks
const call = (database, method, args) =>
  new Promise((resolve, reject) =>
    database.adapter.underlyingAdapter._dispatcher.call(method, args, (result) =>
      result.error ? reject(result.error) : resolve(result.value),
    ),
  )

const titles = async (database) =>
  (await call(database, 'unsafeQueryRaw', ['select title from notes order by title', []])).map(
    (row) => row.title,
  )

const close = (database) => call(database, 'unsafeCloseConnection', [])

afterEach(async () => {
  DatabaseBridge.closeAllConnections()
  adapters = []
  paths.forEach((path) => {
    ;['', '-wal', '-shm', '-journal'].forEach((suffix) => {
      ;[path, decryptedCopyPath(path)].forEach((file) => {
        if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix)
      })
    })
  })
  paths = []
})

describe('SQLiteAdapter encryption on Node', () => {
  it('is available with better-sqlite3-multiple-ciphers', () => {
    expect(SQLiteAdapter.isEncryptionAvailable()).toBe(true)
  })

  it('creates an encrypted database, and opens it only with the passphrase', async () => {
    const path = tempPath()
    expect(await SQLiteAdapter.getDatabaseEncryptionState(path)).toBe('missing')
    const database = await open(path, { passphrase: 'correct horse' })
    expect(await database.isDBEncrypted()).toBe(true)
    await writeNote(database, 'secret note')
    DatabaseBridge.closeAllConnections()

    expect(isPlain(path)).toBe(false)
    expect(fileContains(path, 'secret note')).toBe(false)
    expect(await SQLiteAdapter.getDatabaseEncryptionState(path)).toBe('encrypted')
    const before = fs.readFileSync(path)

    // Errors never touch the file
    expect(await setUpError(path, { passphrase: 'wrong horse' })).toMatchObject({
      code: 'encryption_key_invalid',
    })
    expect(
      await setUpError(path, { passphrase: 'wrong horse', ifUnencrypted: 'open' }),
    ).toMatchObject({
      code: 'encryption_key_invalid',
    })
    expect(await setUpError(path, undefined)).toMatchObject({ code: 'encryption_key_required' })
    expect(fs.readFileSync(path).equals(before)).toBe(true)

    const reopened = await open(path, { passphrase: async () => 'correct horse' })
    expect(await titles(reopened)).toEqual(['secret note'])
  })

  it('opens a plain database only with ifUnencrypted: open, then encrypts, re-keys and decrypts it', async () => {
    const path = tempPath()
    const plain = await open(path, undefined)
    await writeNote(plain, 'from before')
    DatabaseBridge.closeAllConnections()
    expect(await SQLiteAdapter.getDatabaseEncryptionState(path)).toBe('unencrypted')

    expect(await setUpError(path, { passphrase: 'k1' })).toMatchObject({
      code: 'database_not_encrypted',
    })
    expect(isPlain(path)).toBe(true)

    const events = { onStart: jest.fn(), onSuccess: jest.fn(), onError: jest.fn() }
    const database = await open(path, { passphrase: 'k1', ifUnencrypted: 'open', events })
    expect(await database.isDBEncrypted()).toBe(false)

    // encrypt
    await database.write(() => database.unsafe_EncryptDB('k1'))
    expect(await database.isDBEncrypted()).toBe(true)
    expect(events.onStart).toHaveBeenCalledWith(expect.objectContaining({ operation: 'encrypt' }))
    expect(events.onSuccess).toHaveBeenCalledWith(expect.objectContaining({ operation: 'encrypt' }))
    expect(isPlain(path)).toBe(false)
    expect(fileContains(path, 'from before')).toBe(false)
    await writeNote(database, 'after encrypting')

    // change the key
    await database.write(() => database.unsafe_EncryptDB('k2'))
    expect(events.onStart).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'rekey' }))
    expect(await titles(database)).toEqual(['after encrypting', 'from before'])
    DatabaseBridge.closeAllConnections()
    expect(await setUpError(path, { passphrase: 'k1' })).toMatchObject({
      code: 'encryption_key_invalid',
    })

    // decrypt: by copy, which replaces the file
    const encrypted = await open(path, { passphrase: 'k2', ifUnencrypted: 'open' })
    await encrypted.write(() => encrypted.unsafe_DecryptDB())
    expect(await encrypted.isDBEncrypted()).toBe(false)
    await writeNote(encrypted, 'after decrypting')
    expect(await titles(encrypted)).toEqual(['after decrypting', 'after encrypting', 'from before'])
    DatabaseBridge.closeAllConnections()
    expect(isPlain(path)).toBe(true)
    expect(fs.existsSync(decryptedCopyPath(path))).toBe(false)
    expect(await titles(await open(path, undefined))).toHaveLength(3)
    expect(events.onError).not.toHaveBeenCalled()
  })

  it('keeps an encrypted database encrypted through unsafeResetDatabase', async () => {
    const path = tempPath()
    const database = await open(path, { passphrase: 'k1' })
    await writeNote(database, 'gone after reset')
    await database.write(() => database.unsafeResetDatabase())
    await writeNote(database, 'after reset')
    DatabaseBridge.closeAllConnections()

    expect(isPlain(path)).toBe(false)
    expect(await setUpError(path, undefined)).toMatchObject({ code: 'encryption_key_required' })
    expect(await titles(await open(path, { passphrase: 'k1' }))).toEqual(['after reset'])
  })

  it('refuses to change the key while another connection in this process has the file open', async () => {
    const path = tempPath()
    const database = await open(path, { passphrase: 'k1' })
    const other = await open(path, { passphrase: 'k1' })
    await writeNote(database, 'kept')

    for (const change of [
      () => database.unsafe_EncryptDB('k2'),
      () => database.unsafe_DecryptDB(),
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(database.write(change)).rejects.toMatchObject({ code: 'rekey_failed' })
    }
    expect(await titles(other)).toEqual(['kept'])
    expect(await database.isDBEncrypted()).toBe(true)

    await close(other)
    await database.write(() => database.unsafe_EncryptDB('k2'))
    expect(await titles(database)).toEqual(['kept'])
  })

  it("never treats a file it can't read as damaged without a passphrase", async () => {
    const path = tempPath()
    fs.writeFileSync(path, 'not SQLite: maybe encrypted, maybe damaged, never recreated')
    const before = fs.readFileSync(path)
    expect(await setUpError(path, undefined)).toMatchObject({ code: 'encryption_key_required' })
    expect(() => new NodeDatabase(path)).toThrow(/encryption_key_required/)
    expect(fs.readFileSync(path).equals(before)).toBe(true)
  })

  it("can't encrypt an in-memory database", async () => {
    expect(await setUpError(':memory:', { passphrase: 'k1' })).toMatchObject({
      code: 'encryption_unavailable',
    })
  })

  it('deletes the copy a decrypt left behind when it was cut off', async () => {
    const path = tempPath()
    DatabaseBridge.closeAllConnections()
    await open(path, { passphrase: 'k1' })
    DatabaseBridge.closeAllConnections()
    fs.writeFileSync(decryptedCopyPath(path), 'SQLite format 3\0 a plain copy')
    await open(path, { passphrase: 'k1' })
    expect(fs.existsSync(decryptedCopyPath(path))).toBe(false)
  })

  it('reads a database written by SQLCipher 4 itself', () => {
    // SQLCipher's own test database (native/tests/fixtures/README.md), opened as SQLCipher's
    // compatibility test does: same passphrase, same row count
    const path = tempPath()
    fs.copyFileSync(
      `${__dirname}/../../../../../native/tests/fixtures/sqlcipher-4.0-testkey.db`,
      path,
    )
    expect(() => new NodeDatabase(path, { passphrase: 'wrong' })).toThrow(/encryption_key_invalid/)
    const db = new NodeDatabase(path, { passphrase: 'testkey' })
    expect(db.isEncrypted).toBe(true)
    expect(db.count('select count(*) as count from t1')).toBe(78536)
    db.instance.close()
  })

  it('zeroes deleted content on an encrypted connection, as SQLCipher does', async () => {
    const path = tempPath()
    const keyed = new NodeDatabase(path, { passphrase: 'k1' })
    expect(keyed.instance.pragma('secure_delete', { simple: true })).toBe(1)
    keyed.instance.close()
    const plain = new NodeDatabase(tempPath())
    expect(plain.instance.pragma('secure_delete', { simple: true })).toBe(0)
    plain.instance.close()

    // After encrypting a plain database too
    const database = await open(tempPath(), { passphrase: 'k1', ifUnencrypted: 'open' })
    await database.write(() => database.unsafe_EncryptDB('k1'))
    expect(await call(database, 'unsafeQueryRaw', ['pragma secure_delete', []])).toEqual([
      { secure_delete: 1 },
    ])
  })

  it('reads a database encrypted by the native build, and the native build reads ours', () => {
    // Made by the native encryption build (SqliteEncryption.cpp, passphrase "k1"): table t, one row
    const fixture = `${__dirname}/fixtures/native-encrypted-k1.db`
    const path = tempPath()
    fs.copyFileSync(fixture, path)
    const native = new NodeDatabase(path, { passphrase: 'k1' })
    expect(native.isEncrypted).toBe(true)
    expect(native.queryRaw('select v from t')).toEqual([{ v: 'from native' }])
    native.instance.close()

    // And ours is in SQLCipher 4's layout, as natively: page 1 is encrypted from byte 16 on, so a
    // plain header's page size, format versions and reserved bytes (bytes 16-20) aren't there. The
    // native test reads a file written here: native/tests/fixtures/node-encrypted-k1.db
    const ours = tempPath()
    const db = new NodeDatabase(ours, { passphrase: 'k1' })
    db.executeStatements("create table t (v); insert into t values ('from node')")
    db.instance.close()
    expect([...fs.readFileSync(ours).subarray(16, 21)]).not.toEqual([0x10, 0x00, 1, 1, 80])
  })
})

describe('SQLiteAdapter encryption on Node with plain better-sqlite3', () => {
  it('fails loudly instead of writing a plaintext database', () => {
    jest.isolateModules(() => {
      jest.doMock('better-sqlite3-multiple-ciphers', () => {
        const error = new Error("Cannot find module 'better-sqlite3-multiple-ciphers'")
        error.code = 'MODULE_NOT_FOUND'
        throw error
      })
      // eslint-disable-next-line global-require
      const IsolatedAdapter = require('../../index').default
      expect(IsolatedAdapter.isEncryptionAvailable()).toBe(false)
      const path = tempPath()
      let error
      try {
        // eslint-disable-next-line no-new
        new IsolatedAdapter({ dbName: path, schema, encryption: { passphrase: 'k1' } })
      } catch (e) {
        error = e
      }
      expect(error.code).toBe('encryption_unavailable')
      expect(error.message).toMatch(/better-sqlite3-multiple-ciphers/)
      expect(fs.existsSync(path)).toBe(false)
    })
  })
})
