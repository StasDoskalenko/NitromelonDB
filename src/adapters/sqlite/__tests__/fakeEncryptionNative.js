// A fake native SQLite dispatcher for SQLiteAdapter's `encryption` option, following the rules of
// native/shared/SqliteEncryption.cpp (which `yarn test:native-unit` tests for real). Files are kept
// in `files` by name, so a second adapter "reopens" what the first one left.
//
// Each test file mocks '../makeDispatcher' itself (jest.mock must be in the test file), then calls
// installFakeNatives(makeDispatcherModule) in a beforeEach.

export const fake = { files: new Map(), natives: [] }

function codedError(code) {
  const error = new Error(`[${code}] fake native error`)
  error.code = code
  return error
}

// A file is { key, version, header }: `header` is whether it has a plaintext header
export function fakeNative(
  dbName,
  { passphrase = '', allowUnencrypted = false, plaintextHeader = false },
) {
  const { files } = fake
  let open = false
  let encrypted = false
  let rekeying = false
  let progressCalls = 0
  const native = {
    log: [],
    rekeyDelay: 5,
    failRekey: false,
    // What encryptionProgress returns on each call while a re-key runs
    progressSteps: [],
    call(method, args, callback) {
      if (method === 'encryptionProgress') {
        // Never waits, and never opens the database (HybridNitromelonDatabase::encryptionProgress)
        const step = native.progressSteps[Math.min(progressCalls, native.progressSteps.length - 1)]
        progressCalls += 1
        callback({ value: rekeying && step !== undefined ? step : -1 })
        return
      }
      native.log.push(method)
      try {
        const file = files.get(dbName)
        if (!open && method !== 'changeEncryptionKey') {
          // what SqliteDb's constructor does
          if (!file) {
            files.set(dbName, {
              key: passphrase || null,
              version: 0,
              header: !!passphrase && plaintextHeader,
            })
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
          case 'hasPlaintextHeader':
            callback({ value: encrypted && !!current.header })
            return
          case 'unsafeQueryRaw':
            callback({ value: [{ pageCount: 3, byteSize: 12288 }] })
            return
          case 'changeEncryptionKey':
            // a native background thread
            rekeying = true
            progressCalls = 0
            setTimeout(() => {
              rekeying = false
              if (native.failRekey) {
                callback({ error: codedError('rekey_failed') })
                return
              }
              current.key = args[0] || null
              encrypted = !!args[0]
              // encryption::rekey writes the layout the option asks for
              current.header = encrypted && plaintextHeader
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

export function installFakeNatives(makeDispatcherModule) {
  fake.files = new Map()
  fake.natives = []
  makeDispatcherModule.isEncryptionAvailable.mockReturnValue(true)
  makeDispatcherModule.getDispatcherType.mockReturnValue('nitro')
  makeDispatcherModule.makeDispatcher.mockReset()
  makeDispatcherModule.makeDispatcher.mockImplementation((_type, _tag, dbName, options) => {
    const native = fakeNative(dbName, options)
    native.options = options
    fake.natives.push(native)
    return native
  })
}
