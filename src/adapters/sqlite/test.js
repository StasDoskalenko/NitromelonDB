import fs from 'fs'
import { toPromise } from '../../utils/fp/Result'
import { testSchema } from '../__tests__/helpers'
import commonTests from '../__tests__/commonTests'
import sqliteTests from '../__tests__/sqliteTests'

import SqliteAdapter from './index'
import DatabaseAdapterCompat from '../compat'

// Node keeps the native SQLite handle open until told otherwise (no RN app
// lifecycle to close it for us). Deleting the file first and closing after
// left the handle orphaned on Windows, which blocked the delete — close it
// first so the delete actually can succeed.
async function closeAdapter(adapter) {
  await toPromise((callback) => adapter.unsafeCloseConnection(callback))
}

function removeIfExists(file, dbName) {
  if (file && fs.existsSync(dbName)) {
    fs.unlinkSync(dbName)
  }
}

describe.each([['SQLiteAdapterNode', 'Asynchronous', 'Memory']])(
  '%s (%s/%s)',
  (adapterSubclass, _dispatcherType, fileString) => {
    commonTests().forEach((testCase) => {
      const [name, test] = testCase

      if (name.match(/from file system/) && process.platform === 'win32') {
        // eslint-disable-next-line no-console
        console.error(`FIXME: Broken test on Windows! ${name}`)
        return
      }

      // eslint-disable-next-line jest/valid-title
      it(name, async () => {
        const file = fileString.toLowerCase() === 'file'

        if (!fs.existsSync('.tmp')) {
          fs.mkdirSync('.tmp')
        }

        const dbName = `${process.cwd()}/test${Math.random()}.db${
          file ? '' : '?mode=memory&cache=shared'
        }`
        const extraAdapterOptions = {
          dbName,
          adapterSubclass,
        }
        const adapter = new SqliteAdapter({
          dbName,
          schema: testSchema,
        })

        try {
          await adapter.initializingPromise
          await test(new DatabaseAdapterCompat(adapter), SqliteAdapter, extraAdapterOptions, 'node')
        } finally {
          await closeAdapter(adapter)
          removeIfExists(file, dbName)
        }
      })
    })
  },
)

describe('SQLiteAdapterNode (file-backed sqliteTests)', () => {
  if (!fs.existsSync('.tmp')) {
    fs.mkdirSync('.tmp')
  }

  sqliteTests().forEach((testCase) => {
    const [name, test] = testCase
    // eslint-disable-next-line jest/valid-title
    it(name, async () => {
      const dbName = `${process.cwd()}/.tmp/test${Math.random()}.db`
      const adapter = new SqliteAdapter({
        dbName,
        schema: testSchema,
      })

      try {
        await adapter.initializingPromise
        await test(new DatabaseAdapterCompat(adapter), SqliteAdapter, { dbName }, 'node')
      } finally {
        await closeAdapter(adapter)
        removeIfExists(true, dbName)
        removeIfExists(true, `${dbName}-wal`)
        removeIfExists(true, `${dbName}-shm`)
      }
    })
  })
})
