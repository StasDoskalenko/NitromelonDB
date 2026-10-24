import fs from 'fs'
import BetterSqlite3 from 'better-sqlite3'
import Database from '../Database'

// Database#unsafeDestroyEverything wipes the database in place instead of deleting the file,
// so other connections to the same file keep working (#172)

const MARKER = 'needle-7f3a9c'

let paths = []

function tempPath() {
  if (!fs.existsSync('.tmp')) {
    fs.mkdirSync('.tmp')
  }
  const path = `${process.cwd()}/.tmp/destroy${Math.random()}.db`
  paths.push(path)
  return path
}

function seed(db) {
  db.executeStatements(`
    create table tasks (id varchar(16) primary key, name text);
    create index tasks_name on tasks (name);
    create table counters (id integer primary key autoincrement, value text);
    create view task_names as select name from tasks;
    create trigger tasks_ai after insert on tasks begin insert into counters (value) values (new.id); end;
    create table "weird ""name""" (x);
    create table sqliteish (x);
  `)
  db.execute('insert into tasks (id, name) values (?, ?)', ['t1', MARKER.repeat(200)])
  db.userVersion = 7
}

const userObjects = (db) =>
  db
    .queryRaw(`select type, name from sqlite_master where name not like 'sqlite\\_%' escape '\\'`)
    .map(({ type, name }) => `${type}:${name}`)

afterEach(() => {
  paths.forEach((path) => {
    ;['', '-wal', '-shm', '-journal'].forEach((suffix) => {
      if (fs.existsSync(path + suffix)) fs.unlinkSync(path + suffix)
    })
  })
  paths = []
})

describe('sqlite-node Database#unsafeDestroyEverything', () => {
  it('drops every table, view, index and trigger, and resets user_version and autoincrement', () => {
    const db = new Database(tempPath())
    seed(db)
    db.execute('insert into counters (value) values (?)', ['x'])
    expect(userObjects(db)).toHaveLength(7)

    db.unsafeDestroyEverything()

    expect(userObjects(db)).toEqual([])
    expect(db.userVersion).toBe(0)
    db.executeStatements('create table counters (id integer primary key autoincrement, value text)')
    db.execute('insert into counters (value) values (?)', ['y'])
    expect(db.queryRaw('select id from counters')).toEqual([{ id: 1 }])
    db.instance.close()
  })

  it('keeps the file, so other connections to it stay usable', () => {
    const path = tempPath()
    const db = new Database(path)
    seed(db)
    const other = new BetterSqlite3(path)
    const { ino } = fs.statSync(path)

    db.unsafeDestroyEverything()

    expect(fs.statSync(path).ino).toBe(ino)
    // Sees the reset, and can write (was SQLITE_READONLY_DBMOVED, or EBUSY on Windows)
    expect(
      other.prepare(`select count(*) as count from sqlite_master where name = 'tasks'`).get(),
    ).toEqual({ count: 0 })
    other.exec('create table after_reset (x); insert into after_reset values (1)')
    expect(db.queryRaw('select x from after_reset')).toEqual([{ x: 1 }])

    other.close()
    db.instance.close()
  })

  it('leaves none of the old data in the file', () => {
    const path = tempPath()
    const db = new Database(path)
    seed(db)
    expect(fs.readFileSync(path).includes(MARKER)).toBe(true)

    db.unsafeDestroyEverything()
    db.instance.close()

    expect(fs.readFileSync(path).includes(MARKER)).toBe(false)
  })

  it('skips VACUUM if another connection is still reading after the busy timeout', () => {
    const path = tempPath()
    const db = new Database(path)
    seed(db)
    db.instance.pragma('busy_timeout = 50')
    const other = new BetterSqlite3(path)
    let iterator
    // Start a read on the other connection right before VACUUM (after the reset has committed),
    // and keep it open, so VACUUM is busy
    const realExec = db.instance.exec.bind(db.instance)
    db.instance.exec = (sql) => {
      if (sql === 'VACUUM') {
        // Must read a table: a statement that doesn't touch the database takes no read lock
        iterator = other
          .prepare('select 1 from sqlite_master union all select 1 union all select 2')
          .iterate()
        iterator.next()
      }
      return realExec(sql)
    }

    db.unsafeDestroyEverything()
    expect(iterator).toBeDefined()
    expect(userObjects(db)).toEqual([])
    expect(fs.existsSync(path)).toBe(true)

    iterator.return()
    other.close()
    db.instance.close()
  })

  it('throws, without touching the file, when another connection holds the write lock', () => {
    const path = tempPath()
    const db = new Database(path)
    seed(db)
    db.instance.pragma('busy_timeout = 50')
    const other = new BetterSqlite3(path)
    other.exec('begin immediate')
    const { ino } = fs.statSync(path)

    expect(() => db.unsafeDestroyEverything()).toThrow(/locked|busy/i)
    expect(fs.statSync(path).ino).toBe(ino)

    other.exec('rollback')
    expect(userObjects(db)).toHaveLength(7)
    other.close()
    db.instance.close()
  })

  describe('recovers from a corrupt file by recreating it', () => {
    const resetAndUse = (path) => {
      const db = new Database(path)
      db.unsafeDestroyEverything()
      db.executeStatements('create table ok (x); insert into ok values (1);')
      expect(db.queryRaw('select x from ok')).toEqual([{ x: 1 }])
      expect(db.userVersion).toBe(0)
      db.instance.close()
    }

    const seededFile = () => {
      const path = tempPath()
      const db = new Database(path)
      seed(db)
      db.inTransaction(() => {
        for (let i = 0; i < 200; i += 1) {
          db.execute('insert into tasks (id, name) values (?, ?)', [`r${i}`, 'x'.repeat(500)])
        }
      })
      db.instance.close()
      return path
    }

    it('not a database at all', () => {
      const path = tempPath()
      fs.writeFileSync(path, Buffer.alloc(8192, 0x41))
      resetAndUse(path)
    })

    it('corrupted pages', () => {
      const path = seededFile()
      const file = fs.readFileSync(path)
      const pageSize = file.readUInt16BE(16)
      for (let page = 2; page < 6; page += 1) {
        file.fill(0xff, page * pageSize, page * pageSize + 200)
      }
      fs.writeFileSync(path, file)
      resetAndUse(path)
    })

    it('truncated', () => {
      const path = seededFile()
      fs.truncateSync(path, 4096 * 3 + 100)
      resetAndUse(path)
    })

    it('with a leftover rollback journal, which is removed rather than replayed', () => {
      const path = tempPath()
      fs.writeFileSync(path, Buffer.alloc(8192, 0x41))
      fs.writeFileSync(`${path}-journal`, Buffer.alloc(4096, 0x42))
      resetAndUse(path)
      expect(fs.existsSync(`${path}-journal`)).toBe(false)
    })
  })

  it('works on in-memory databases', () => {
    const db = new Database(':memory:')
    seed(db)

    db.unsafeDestroyEverything()

    expect(userObjects(db)).toEqual([])
    expect(db.userVersion).toBe(0)
    db.instance.close()
  })
})
