import { Platform } from 'react-native'
import SQLiteAdapter from './index'
import { testSchema } from '../__tests__/helpers'
import commonTests from '../__tests__/commonTests'
import sqliteTests from '../__tests__/sqliteTests'
import { invariant } from '../../utils/common'
import DatabaseAdapterCompat from '../compat'

const SQLiteAdapterTest = (spec) => {
  const isWeb = Platform.OS === 'web'
  const configurations = [
    isWeb
      ? { name: 'SQLiteAdapter (wa-sqlite)', options: {}, expectedDispatcherType: 'wa-sqlite' }
      : { name: 'SQLiteAdapter (Nitro)', options: {}, expectedDispatcherType: 'nitro' },
  ]

  configurations.forEach(({ name: configurationName, options, expectedDispatcherType }) => {
    spec.describe(configurationName, () => {
      spec.it('configures adapter correctly', async () => {
        const adapter = new SQLiteAdapter({ schema: testSchema, ...options })
        expect(adapter._dispatcherType).toBe(expectedDispatcherType)
        if (isWeb) {
          await adapter.initializingPromise
        }
      })

      // These builds have no encryption (the default), so a passphrase must fail loudly, before
      // anything is written. The encryption build is tested by `yarn test:native-unit` and by the
      // NotesApp encryption upgrade job (scripts/ci-notesapp-encryption-upgrade.sh).
      spec.it('fails loudly when given a passphrase without the encryption build', async () => {
        expect(SQLiteAdapter.isEncryptionAvailable()).toBe(false)
        let error = null
        try {
          // eslint-disable-next-line no-new
          new SQLiteAdapter({ schema: testSchema, ...options, encryption: { passphrase: 'k' } })
        } catch (e) {
          error = e
        }
        expect(error && error.code).toBe('encryption_unavailable')
        if (!isWeb) {
          // Reads the file header natively; never creates the file
          const dbName = `never-created-${Math.random().toString(36).slice(2)}`
          expect(await SQLiteAdapter.getDatabaseEncryptionState(dbName)).toBe('missing')
        }
      })

      // Adapter option validation is deliberately disabled in production builds. The web
      // integration suite runs against the production Expo export, so keep that assertion in
      // Jest/development while exercising the runtime contract here.
      const testCases = commonTests().filter(
        ([testName]) =>
          !(
            isWeb &&
            process.env.NODE_ENV === 'production' &&
            testName === 'validates adapter options'
          ),
      )
      const onlyTestCases = testCases.filter(([, , isOnly]) => isOnly)
      const testCasesToRun = onlyTestCases.length ? onlyTestCases : testCases

      testCasesToRun.forEach((testCase) => {
        const [name, test] = testCase
        spec.it(name, async () => {
          const dbName = `file:testdb${Math.random()}?mode=memory&cache=shared`
          const adapter = new SQLiteAdapter({ schema: testSchema, dbName, ...options })
          invariant(
            adapter._dispatcherType === expectedDispatcherType,
            `Expected adapter to be ${expectedDispatcherType}`,
          )
          if (isWeb) {
            await adapter.initializingPromise
          }
          await test(
            new DatabaseAdapterCompat(adapter),
            SQLiteAdapter,
            { dbName, ...options },
            Platform.OS,
          )
        })
      })

      // sqlite-specific tests (file-backed only, skip on LokiJS)
      sqliteTests().forEach((testCase) => {
        const [name, test] = testCase
        spec.it(name, async () => {
          const dbName = `file:testdb${Math.random()}?mode=memory&cache=shared`
          const adapter = new SQLiteAdapter({ schema: testSchema, dbName, ...options })
          invariant(
            adapter._dispatcherType === expectedDispatcherType,
            `Expected adapter to be ${expectedDispatcherType}`,
          )
          if (isWeb) {
            await adapter.initializingPromise
          }
          await test(
            new DatabaseAdapterCompat(adapter),
            SQLiteAdapter,
            { dbName, ...options },
            Platform.OS,
          )
        })
      })

      if (onlyTestCases.length) {
        spec.it('BROKEN SETUP', async () => {
          throw new Error('Do not commit tests with it.only')
        })
      }
    })
  })
}

export default SQLiteAdapterTest
