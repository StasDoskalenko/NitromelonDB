// Encryption for the Node/Electron SQLite adapter: the same rules, error codes and file format as
// native/shared/SqliteEncryption.cpp (iOS, Android, Windows), on better-sqlite3-multiple-ciphers,
// which is better-sqlite3 with SQLite3 Multiple Ciphers (sqlite3mc) inside. With plain
// better-sqlite3 a passphrase fails loudly (encryption_unavailable) instead of writing a
// plaintext database.
//
// Comments here only cover what differs from the native code; the reasons are in its comments and in
// docs/plans/sqlcipher-encryption.md.

const fs = require('fs') as {
  openSync: (path: string, flags: string) => number
  readSync: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number
  closeSync: (fd: number) => void
  fsyncSync: (fd: number) => void
  existsSync: (path: string) => boolean
  unlinkSync: (path: string) => void
  renameSync: (from: string, to: string) => void
}

// (No Node type definitions in this package)
type Bytes = Uint8Array
const { Buffer } = require('buffer') as {
  Buffer: { from: (text: string, encoding: 'utf8') => Bytes; alloc: (size: number) => Bytes }
}
const os = require('os') as { platform: () => string }

export type SqliteStatement = {
  run: (args: unknown[]) => unknown
  get: (args?: unknown[]) => unknown
  all: (args: unknown[]) => unknown[]
}

export type SqliteDatabase = {
  open: boolean
  memory: boolean
  inTransaction: boolean
  transaction: (executeBlock: () => void) => () => void
  prepare: (query: string) => SqliteStatement
  exec: (queries: string) => unknown
  pragma: ((sql: string, options: { simple: boolean }) => unknown) & ((sql: string) => unknown)
  close: () => void
  // better-sqlite3-multiple-ciphers only
  key?: (key: Bytes) => number
  rekey?: (key: Bytes) => number
}

export type BetterSqlite3Constructor = new (
  path: string,
  options?: { verboze?: typeof console.log },
) => SqliteDatabase

export type EncryptionConfig = {
  passphrase?: string | undefined
  allowUnencrypted?: boolean | undefined
}

// 'encrypted-plaintext-header': encrypted with a plaintext header (`encryption.plaintextHeader`),
// which the Node adapter doesn't open (see probeFile)
export type FileState = 'missing' | 'unencrypted' | 'encrypted' | 'encrypted-plaintext-header'

const GUIDE =
  'https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Setup#nodejs-and-electron'

export const NODE_SWITCH_HINT = `On Node and Electron, encryption needs better-sqlite3-multiple-ciphers: install it (yarn add better-sqlite3-multiple-ciphers; in Electron, rebuild it for Electron like better-sqlite3), and NitromelonDB uses it instead of better-sqlite3. See ${GUIDE}`

export class EncryptionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.code = code
    this.name = 'EncryptionError'
  }
}

// The cipher settings of the native encryption build (NitromelonSqliteConfig.h): sqlite3mc's
// SQLCipher scheme in SQLCipher 4's own file layout (`legacy = 4`), which SQLCipher and its tools
// read. better-sqlite3-multiple-ciphers defaults to another cipher (ChaCha20), so every connection
// sets it, keyed or not (a re-key of a plain database uses it).
const CIPHER_SQL = "pragma cipher = 'sqlcipher'; pragma legacy = 4;"

// Every keyed connection, as natively (kKeyedConnectionSql in SqliteEncryption.cpp): temp files
// stay in memory (they aren't encrypted), and deleted content is zeroed (secure_delete, on by
// default in SQLCipher)
const KEYED_SQL = 'pragma temp_store = memory; pragma secure_delete = on;'

const PLAIN_HEADER = 'SQLite format 3\0'
const TEXT_ENCODING_OFFSET = 56
const JOURNAL_MAGIC = [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]

export function isMemoryPath(path: string): boolean {
  return path === ':memory:' || path === 'file::memory:' || path.includes('mode=memory')
}

// The file behind a path or a `file:` URI ('' for in-memory databases)
export function filePath(path: string): string {
  if (!path || isMemoryPath(path)) {
    return ''
  }
  if (!path.startsWith('file:')) {
    return path
  }
  let rest = path.slice('file:'.length)
  const query = rest.indexOf('?')
  if (query >= 0) {
    rest = rest.slice(0, query)
  }
  if (rest.startsWith('//localhost/')) {
    rest = rest.slice('//localhost'.length)
  } else if (rest.startsWith('//')) {
    rest = rest.slice(2)
  }
  return decodeURIComponent(rest)
}

export function decryptedCopyPath(path: string): string {
  return `${filePath(path)}-nitromelon-decrypted`
}

function readStart(path: string, length: number): Uint8Array {
  let fd: number
  try {
    fd = fs.openSync(path, 'r')
  } catch {
    return new Uint8Array(0)
  }
  try {
    const buffer = new Uint8Array(length)
    const read = fs.readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

export function probeFile(path: string): FileState {
  const file = filePath(path)
  if (!file) {
    return 'missing'
  }
  const header = readStart(file, TEXT_ENCODING_OFFSET + 4)
  if (header.length === 0) {
    return 'missing'
  }
  if (
    header.length < PLAIN_HEADER.length ||
    !header.subarray(0, PLAIN_HEADER.length).every((byte, i) => byte === PLAIN_HEADER.charCodeAt(i))
  ) {
    return 'encrypted'
  }
  // A database with a plaintext header (32 bytes) is encrypted from there on, so its text encoding
  // (0 to 3 in a plain database) is random. As natively (probeFile in SqliteEncryption.cpp)
  const encoding = header.subarray(TEXT_ENCODING_OFFSET)
  const plainEncoding =
    encoding.length === 4 &&
    encoding[0] === 0 &&
    encoding[1] === 0 &&
    encoding[2] === 0 &&
    encoding[3] <= 3
  return plainEncoding || encoding.length < 4 ? 'unencrypted' : 'encrypted-plaintext-header'
}

export function hasHotJournal(path: string): boolean {
  const file = filePath(path)
  if (!file) {
    return false
  }
  const magic = readStart(`${file}-journal`, JOURNAL_MAGIC.length)
  return (
    magic.length === JOURNAL_MAGIC.length && magic.every((byte, i) => byte === JOURNAL_MAGIC[i])
  )
}

function removeDatabaseFiles(path: string): void {
  ;['', '-journal', '-wal', '-shm'].forEach((suffix) => {
    if (fs.existsSync(path + suffix)) {
      fs.unlinkSync(path + suffix)
    }
  })
}

function syncFile(path: string): void {
  const fd = fs.openSync(path, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

// Makes a rename durable. Not possible (or needed) for a directory on Windows
function syncDirectoryOf(path: string): void {
  if (os.platform() === 'win32') {
    return
  }
  const slash = path.lastIndexOf('/')
  const dir = slash < 0 ? '.' : slash === 0 ? '/' : path.slice(0, slash)
  try {
    const fd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    // Best effort, as natively
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

// key() and rekey() exist on better-sqlite3-multiple-ciphers, which is the only package these run with
function keyWith(db: SqliteDatabase, key: Bytes): number {
  if (!db.key) {
    throw new EncryptionError('encryption_unavailable', NODE_SWITCH_HINT)
  }
  return db.key(key)
}

function rekeyWith(db: SqliteDatabase, key: Bytes): number {
  if (!db.rekey) {
    throw new EncryptionError('encryption_unavailable', NODE_SWITCH_HINT)
  }
  return db.rekey(key)
}

// Sets the cipher, then the key if there is one. Never `pragma key`: SQL text can end up in error
// messages and traces
export function configureCipher(db: SqliteDatabase, passphrase: string): void {
  db.exec(CIPHER_SQL)
  if (passphrase) {
    const result = keyWith(db, Buffer.from(passphrase, 'utf8'))
    if (result !== 0) {
      throw new EncryptionError('encryption_key_invalid', "Couldn't apply the passphrase")
    }
  }
}

export class NodeEncryption {
  Sqlite: BetterSqlite3Constructor

  hasCodec: boolean

  constructor(Sqlite: BetterSqlite3Constructor, hasCodec: boolean) {
    this.Sqlite = Sqlite
    this.hasCodec = hasCodec
  }

  // Rolls back a hot journal with a connection keyed with `passphrase` (or not). Returns whether
  // it's gone
  rollBackJournal(path: string, passphrase: string): boolean {
    let db: SqliteDatabase | undefined
    try {
      db = new this.Sqlite(path)
      configureCipher(db, passphrase)
      // The first read rolls the journal back
      db.prepare('select count(*) from sqlite_master').get()
    } catch {
      return false
    } finally {
      db?.close()
    }
    return !hasHotJournal(path)
  }

  recoverInterruptedRekey(path: string, passphrase: string): void {
    const file = filePath(path)
    if (!file) {
      return
    }
    removeDatabaseFiles(decryptedCopyPath(path))
    if (!this.hasCodec || !hasHotJournal(path)) {
      return
    }
    if (passphrase && this.rollBackJournal(file, passphrase)) {
      return
    }
    this.rollBackJournal(file, '')
  }

  // Before anything else touches the file. Returns whether the connection is encrypted
  openWithKey(
    db: SqliteDatabase,
    path: string,
    state: FileState,
    passphrase: string,
    allowUnencrypted: boolean,
  ): boolean {
    if (this.hasCodec) {
      db.exec(CIPHER_SQL)
    }
    if (state === 'encrypted-plaintext-header') {
      throw new EncryptionError(
        'encryption_unavailable',
        "The database is encrypted with a plaintext header (encryption.plaintextHeader, for iOS App Groups), which only iOS, Android and Windows open. To open it here, open it once in the app without `plaintextHeader`, which moves it back to SQLCipher's usual layout. NitromelonDB didn't change the file.",
      )
    }
    if (!passphrase) {
      // With plain better-sqlite3, a file that isn't SQLite is a damaged database, as it always was
      // on Node (unsafeResetDatabase() recreates it). With the cipher package, it may be an encrypted
      // one: refuse, and never touch it, as natively
      if (state === 'encrypted' && this.hasCodec) {
        throw new EncryptionError(
          'encryption_key_required',
          "The database is encrypted (or isn't a SQLite database), and no passphrase was given. Pass the passphrase it was encrypted with as `encryption.passphrase`. NitromelonDB didn't change the file.",
        )
      }
      return false
    }
    if (!this.hasCodec) {
      throw new EncryptionError(
        'encryption_unavailable',
        `A passphrase was given, but better-sqlite3 has no encryption, so the database would not be encrypted. ${NODE_SWITCH_HINT}`,
      )
    }
    if (state === 'unencrypted') {
      if (!allowUnencrypted) {
        throw new EncryptionError(
          'database_not_encrypted',
          "A passphrase was given, but the database on disk isn't encrypted. To open it and encrypt it, pass `encryption: { ifUnencrypted: 'open' }` and call database.unsafe_EncryptDB(passphrase) in a writer. NitromelonDB didn't change the file.",
        )
      }
      return false
    }
    if (db.memory) {
      throw new EncryptionError(
        'encryption_unavailable',
        "In-memory databases can't be encrypted: give the database a file (dbName).",
      )
    }

    configureCipher(db, passphrase)
    // The key is only checked when the first page is read
    try {
      db.prepare('select count(*) from sqlite_master').get()
    } catch (error) {
      if (errorCode(error) === 'SQLITE_NOTADB') {
        throw new EncryptionError(
          'encryption_key_invalid',
          hasHotJournal(path)
            ? "The passphrase is wrong. A change of the database's passphrase was interrupted (the app was closed during database.unsafe_EncryptDB()), so the database still has its previous passphrase: open it with that one. NitromelonDB didn't change the file."
            : "The passphrase is wrong, or the file isn't a database encrypted by NitromelonDB or SQLCipher 4. NitromelonDB didn't change the file.",
        )
      }
      throw new Error(`Couldn't read the encrypted database: ${errorMessage(error)}`)
    }
    db.exec(KEYED_SQL)
    return true
  }

  // Leaves WAL if the database is in it. The Node adapter doesn't turn WAL on, but an app's raw SQL
  // may have
  leaveWal(db: SqliteDatabase): boolean {
    if (db.pragma('journal_mode', { simple: true }) !== 'wal') {
      return false
    }
    try {
      db.exec('pragma journal_mode = delete')
    } catch {
      // checked below
    }
    if (db.pragma('journal_mode', { simple: true }) === 'wal') {
      throw new EncryptionError(
        'rekey_failed',
        "Couldn't leave WAL mode to change the encryption key (is another connection open?)",
      )
    }
    return true
  }

  // Encrypts (current '' → new), changes the key, or decrypts (new ''). `reopen` opens the database
  // file again with a passphrase (or none); decrypting replaces the file, so it returns the new
  // connection. Returns the connection to use from now on.
  rekey(
    db: SqliteDatabase,
    path: string,
    currentPassphrase: string,
    newPassphrase: string,
    reopen: (passphrase: string) => SqliteDatabase,
  ): SqliteDatabase {
    if (!this.hasCodec) {
      throw new EncryptionError(
        'encryption_unavailable',
        `This build of NitromelonDB has no encryption. ${NODE_SWITCH_HINT}`,
      )
    }
    if (!filePath(path) || db.memory) {
      throw new EncryptionError(
        'encryption_unavailable',
        "In-memory databases can't be encrypted: give the database a file (dbName).",
      )
    }
    if (db.inTransaction) {
      throw new EncryptionError(
        'rekey_failed',
        "Can't change the encryption key while a transaction is open.",
      )
    }
    if (!newPassphrase) {
      return currentPassphrase ? this.decryptByCopy(db, path, currentPassphrase, reopen) : db
    }

    const wasWal = this.leaveWal(db)
    let failure: unknown
    try {
      const result = rekeyWith(db, Buffer.from(newPassphrase, 'utf8'))
      if (result !== 0) {
        failure = new Error(`sqlite3mc returned ${result}`)
      }
    } catch (error) {
      failure = error
    }
    if (wasWal) {
      db.exec('pragma journal_mode = wal')
    }
    if (failure) {
      throw new EncryptionError(
        'rekey_failed',
        `Couldn't change the encryption key: ${errorMessage(failure)}. The database keeps its previous key.`,
      )
    }
    db.exec(KEYED_SQL)
    return db
  }

  // In place, a decrypt cut off at its commit leaves a file no key opens (see the native code), so
  // it's a copy that replaces the database. Natively that copy is written unencrypted directly, by
  // `VACUUM INTO 'file:...?key='`; better-sqlite3 has no URI filenames, so here the copy is written
  // with the same key and then decrypted in place: if that's cut off, only the copy is lost (and
  // deleted on the next open).
  decryptByCopy(
    db: SqliteDatabase,
    path: string,
    currentPassphrase: string,
    reopen: (passphrase: string) => SqliteDatabase,
  ): SqliteDatabase {
    const file = filePath(path)
    const copy = decryptedCopyPath(path)
    removeDatabaseFiles(copy)

    const wasWal = this.leaveWal(db)
    const fail = (message: string): never => {
      removeDatabaseFiles(copy)
      if (wasWal && db.open) {
        db.exec('pragma journal_mode = wal')
      }
      throw new EncryptionError(
        'rekey_failed',
        `${message}. The database is still encrypted, with the same passphrase.`,
      )
    }

    try {
      db.prepare('vacuum into ?').run([copy])
    } catch (error) {
      fail(
        `Couldn't write a copy of the database (is there enough free space?): ${errorMessage(error)}`,
      )
    }
    let copyDb: SqliteDatabase | undefined
    try {
      copyDb = new this.Sqlite(copy)
      configureCipher(copyDb, currentPassphrase)
      const result = rekeyWith(copyDb, Buffer.alloc(0))
      if (result !== 0) {
        throw new Error(`sqlite3mc returned ${result}`)
      }
      copyDb.close()
      copyDb = undefined
      syncFile(copy)
    } catch (error) {
      copyDb?.close()
      fail(`Couldn't decrypt the copy of the database: ${errorMessage(error)}`)
    }

    db.close()
    try {
      fs.renameSync(copy, file)
    } catch (error) {
      // Still the encrypted file: open it again as it was
      removeDatabaseFiles(copy)
      reopen(currentPassphrase)
      throw new EncryptionError(
        'rekey_failed',
        `Couldn't replace the database with its decrypted copy (${errorMessage(error)}). The database is still encrypted, with the same passphrase.`,
      )
    }
    syncDirectoryOf(file)
    return reopen('')
  }
}
