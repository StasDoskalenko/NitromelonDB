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

  it("doesn't wait for another connection that's reading, and still leaves no old data", () => {
    const path = tempPath()
    const db = new Database(path)
    seed(db)
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

    const start = Date.now()
    db.unsafeDestroyEverything()
    expect(Date.now() - start).toBeLessThan(2000)
    expect(iterator).toBeDefined()
    expect(userObjects(db)).toEqual([])

    iterator.return()
    other.close()
    db.instance.close()
    // VACUUM didn't run, but secure_delete zeroed the freed pages
    expect(fs.readFileSync(path).includes(MARKER)).toBe(false)
  })

  it('works on in-memory databases', () => {
    const db = new Database(':memory:')
    seed(db)

    db.unsafeDestroyEverything()

    expect(userObjects(db)).toEqual([])
    expect(db.userVersion).toBe(0)
    db.instance.close()
  })

  it('restores secure_delete and busy_timeout', () => {
    const db = new Database(tempPath())
    seed(db)
    db.instance.pragma('busy_timeout = 1234')

    db.unsafeDestroyEverything()

    expect(db.instance.pragma('secure_delete', { simple: true })).toBe(0)
    expect(db.instance.pragma('busy_timeout', { simple: true })).toBe(1234)
    db.instance.close()
  })
})
