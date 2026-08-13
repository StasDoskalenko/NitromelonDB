/* eslint-disable no-continue */

import forEachAsync from '../../utils/fp/forEachAsync'
import type Database from '../../Database'
import type Collection from '../../Collection'
import type Model from '../../Model'
import { columnName, type TableName, type ColumnName } from '../../Schema'
import * as Q from '../../QueryDescription'
import type { BelongsToAssociation } from '../../Model'
import censorRaw from '../censorRaw'
import type { DiagnoseDatabaseStructureOptions, DatabaseStructureDiagnosis } from './index'

type CollectionParent = {
  name: string
  parents: Array<[string, ColumnName]>
}

type LokiRecord = { $loki: number; [key: string]: unknown }

type LokiUniqueIndex = {
  lokiMap: Record<string, unknown>
  keyMap: Record<string, LokiRecord | undefined>
}

type LokiCollection = {
  name: string
  idIndex?: number[] | undefined
  data: LokiRecord[]
  binaryIndices: Record<string, unknown>
  uniqueNames: string[]
  constraints: { unique: Record<string, LokiUniqueIndex | undefined> }
  get: (lokiId: string) => LokiRecord | undefined
  checkIndex: (key: string, options?: { repair?: boolean }) => boolean
}

type LokiDatabase = {
  collections: LokiCollection[]
}

const pad = (text: string, len: number) => {
  const padding = Array(Math.max(0, len - text.length))
    .fill(' ')
    .join('')
  return `${text}${padding}`
}

const yieldLog = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

const getCollections = (db: Database): CollectionParent[] =>
  Object.entries(db.collections.map).map(([table, collection]) => {
    const { associations } = (collection as Collection<Model>).modelClass
    const parents = Object.entries(associations)
      .filter((entry): entry is [string, BelongsToAssociation] => entry[1].type === 'belongs_to')
      .map(([parentTable, association]) => [parentTable, association.key] as [string, ColumnName])
    return {
      name: table,
      parents,
    }
  })

const logCollections = (log: (text?: string) => void, collections: CollectionParent[]) => {
  collections.forEach(({ name, parents }) => {
    const parentsText = parents.length
      ? parents.map(([table, key]) => pad(`${table}(${key})`, 27)).join(', ')
      : '(root)'

    log(`- ${pad(name, 20)}: ${parentsText}`)
  })
  log()
}

const isUniqueIndexValid = (collection: LokiCollection, key: string) => {
  const index = collection.constraints.unique[key]

  if (!index) {
    return { skip: true as const }
  }

  const lokiMap = Object.entries(index.lokiMap)
  // >= and undefined checks are needed because items are not removed from unique index, just made undefined
  const lokiMapValid =
    lokiMap.length >= collection.data.length &&
    lokiMap.every(([lokiId, value]) => {
      const record = collection.get(lokiId)
      return value === undefined || (record !== undefined && record[key] === value)
    })

  const keyMap = Object.entries(index.keyMap)
  const keyMapValid =
    keyMap.length >= collection.data.length &&
    keyMap.every(([value, record]) => {
      if (record === undefined) {
        return true
      }
      return record[key] === value && collection.get(String(record.$loki)) === record
    })

  return { skip: false as const, lokiMapValid, keyMapValid }
}

function getLokiDatabase(db: Database): LokiDatabase | undefined {
  const adapter = db.adapter.underlyingAdapter as unknown as {
    constructor: { adapterType?: string }
    _driver?: { loki?: LokiDatabase }
  }
  if (adapter.constructor.adapterType !== 'loki') {
    return undefined
  }
  return adapter._driver?.loki
}

async function verifyLokiIndices(db: Database, log: (text?: string) => void): Promise<number> {
  log('## Verify LokiJS indices')
  let issueCount = 0

  const loki = getLokiDatabase(db)
  if (!loki) {
    return issueCount
  }

  loki.collections.forEach((collection) => {
    const { name, idIndex, data, binaryIndices, uniqueNames } = collection
    log(`**Indices of \`${name}\`**`)
    log()

    // check idIndex
    if (idIndex) {
      if (
        idIndex.length === data.length &&
        idIndex.every((lokiId, i) => data[i]?.$loki === lokiId)
      ) {
        log('idIndex: ok')
      } else {
        log('❌ idIndex: corrupted!')
        issueCount += 1
      }
    } else {
      log('idIndex: (skipping)')
    }

    // check binary indices
    const binKeys = Object.keys(binaryIndices)
    binKeys.forEach((binKey) => {
      if (collection.checkIndex(binKey, { repair: true })) {
        log(`${binKey} binary index: ok`)
      } else {
        log(`❌ ${binKey} binary index: corrupted! checking if repaired...`)
        issueCount += 1

        if (collection.checkIndex(binKey)) {
          log('repaired ok')
        } else {
          log('❌❌ still broken after repair!')
        }
      }
    })

    // check unique indices
    if (name !== 'local_storage' && !(uniqueNames.length === 1 && uniqueNames[0] === 'id')) {
      log(`❌ expected to only have a single unique index for 'id', has: ${uniqueNames.join(', ')}`)
      issueCount += 1
    }

    uniqueNames.forEach((key) => {
      const results = isUniqueIndexValid(collection, key)
      if (!results.skip) {
        if (results.lokiMapValid) {
          log(`${key} index loki map: ok`)
        } else {
          log(`❌ ${key} index loki map: corrupted!`)
          issueCount += 1
        }

        if (results.keyMapValid) {
          log(`${key} index key map: ok`)
        } else {
          log(`❌ ${key} index key map: corrupted!`)
          issueCount += 1
        }
      } else {
        log(`${key} index: (skipping)`)
      }
    })
    log()
  })

  return issueCount
}

export default function diagnoseDatabaseStructure({
  db,
  log: _log = () => {},
  shouldSkipParent = () => false,
  isOrphanAllowed = async () => false,
}: DiagnoseDatabaseStructureOptions): Promise<DatabaseStructureDiagnosis> {
  return db.read(async () => {
    const startTime = Date.now()
    let logText = ''
    const log = (text: string = '') => {
      logText = `${logText}\n${text}`
      _log(text)
    }

    let totalIssueCount = 0

    log('# Database structure diagnostics')
    log()

    if (getLokiDatabase(db)) {
      // eslint-disable-next-line require-atomic-updates
      totalIssueCount += await verifyLokiIndices(db, log)
    }

    log('## Collection parent-child relations')
    log()

    const collections = getCollections(db)
    log('```')
    logCollections(log, collections)
    log('```')
    await yieldLog()

    await forEachAsync(collections, async ({ name, parents }) => {
      log(`## Structure of ${name}`)
      log()

      if (!parents.length) {
        log(`(skipping - no parents)`)
        log()
        return
      }
      await yieldLog()

      const records = await db.collections.get(name as TableName).query().fetch()
      log(`Found ${records.length} \`${name}\``)
      await yieldLog()

      let collectionOrphanCount = 0

      await forEachAsync(parents, async ([parentName, key]) => {
        const expectedParentSet = new Set<string>()
        records.forEach((record) => {
          const id = record._getRaw(key)
          if (
            id !== null &&
            !shouldSkipParent({
              tableName: name as TableName,
              parentTableName: parentName as TableName,
              relationKey: key,
              record: record._raw,
            })
          ) {
            expectedParentSet.add(String(id))
          }
        })
        const expectedParents = [...expectedParentSet]
        const parentsFound = await db.collections
          .get(parentName as TableName)
          .query(Q.where(columnName('id'), Q.oneOf(expectedParents)))
          .fetch()
        log()
        log(`Found ${parentsFound.length} parent \`${parentName}\` (via \`${name}.${key}\`)`)

        const allowedOprhans: Model[] = []

        if (parentsFound.length !== expectedParents.length) {
          const foundParentSet = new Set(parentsFound.map((record) => record.id))
          const orphans: Model[] = []

          await forEachAsync(records, async (record) => {
            const parentId = record._getRaw(key)
            if (
              parentId === null ||
              foundParentSet.has(String(parentId)) ||
              shouldSkipParent({
                tableName: name as TableName,
                parentTableName: parentName as TableName,
                relationKey: key,
                record: record._raw,
              })
            ) {
              // ok
            } else if (
              await isOrphanAllowed({
                tableName: name as TableName,
                parentTableName: parentName as TableName,
                relationKey: key,
                record: record._raw,
              })
            ) {
              allowedOprhans.push(record)
            } else {
              orphans.push(record)
            }
          })

          if (orphans.length) {
            collectionOrphanCount += orphans.length
            log(
              `❌ Error! ${
                expectedParents.length - parentsFound.length
              } missing parent \`${parentName}\` across ${orphans.length} orphans:`,
            )
            orphans.forEach((orphan) => {
              log()
              log(`MISSING PARENT \`${parentName}.${orphan._getRaw(key)} (via ${key})\`:`)
              log()
              log('```')
              log(`${JSON.stringify(censorRaw(orphan._raw), null, '  ')}`)
              log('```')
            })
          }
          await yieldLog()

          if (allowedOprhans.length) {
            log(`❓ Config allowed ${allowedOprhans.length} orphans for this field`)
          }
        }

        await yieldLog()
      })

      totalIssueCount += collectionOrphanCount
      log()
    })

    log('## Conclusion')
    log()
    if (totalIssueCount) {
      log(`❌ ${totalIssueCount} issues found`)
    } else {
      log(`✅ No issues found in this database!`)
    }

    log()
    log(`Done in ${(Date.now() - startTime) / 1000} s.`)
    return { issueCount: totalIssueCount, log: logText }
  })
}
