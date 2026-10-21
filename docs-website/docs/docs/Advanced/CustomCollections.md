# Custom Collections

Every table gets one `Collection` instance, created when the `Database` is constructed. By default it's a
plain `Collection`, but a Model can point its table at your own `Collection` subclass with
**`static associatedCollectionClass`**:

```js
import { Model, Collection, Q } from 'nitromelondb'
import { field, date, writer, reader } from 'nitromelondb/decorators'

class NoteCollection extends Collection {
  @writer async createNote(title, body) {
    return this.create((note) => {
      note.title = title
      note.body = body
    })
  }

  @reader async countArchived() {
    return this.query(Q.where('is_archived', true)).fetchCount()
  }

  pinned() {
    return this.query(Q.where('is_pinned', true), Q.sortBy('updated_at', Q.desc))
  }
}

class Note extends Model {
  static table = 'notes'
  static associatedCollectionClass = NoteCollection

  @field('title') title
  @field('body') body
  @field('is_pinned') isPinned
  @field('is_archived') isArchived
  @date('updated_at') updatedAt
}
```

`database.get('notes')` (or `database.get(Note)`) now returns your `NoteCollection`:

```js
const notes = database.get(Note)
const note = await notes.createNote('Groceries', 'Milk, eggs')
const pinned = await notes.pinned().fetch()
```

This is the same idea as a _repository_ in other ORMs (TypeORM custom repositories, Doctrine repository
classes): a class for logic that belongs to a whole table rather than to one record.

## When to use it

- **Creating records.** A `@writer` method on a Model needs an existing record to be called on, and
  creation doesn't have one yet. A Collection method is the natural home for "create a note with
  these defaults".
- **Bulk and aggregate operations** that work across many records, like "archive all notes older
  than 30 days", "purge soft-deleted records", or "import this list".
- **Named queries.** `notes.pinned()` or `notes.byOwner(userId)` instead of repeating the same
  `Q.where(...)` clauses throughout your UI code.
- **Multi-table writes with one entry point**, e.g. `notes.createWithTags(title, tags)` that batches
  the note and its tag rows in a single writer.

## Writers and readers

`@writer` and `@reader` work on Collection methods the same way they do on Model methods (see
[Writers](../Writers.md)). The method runs inside `database.write()` / `database.read()`, labelled
with the table name and method name (`notes.createNote` above). Inside a Collection method:

- `this.database` is the `Database`
- `this.create()`, `this.query()`, `this.find()`, etc. are the Collection's own methods

`Collection` doesn't have `Model`'s `callWriter()` / `callReader()` helpers. If a Collection method
needs to call another `@writer` (on a record, or on another Collection), use `database.write()`
directly instead of the decorator, and nest through the `writer` argument it passes you:

```js
class NoteCollection extends Collection {
  archiveAll() {
    return this.database.write(async (writer) => {
      const notes = await this.query(Q.where('is_archived', false)).fetch()
      for (const note of notes) {
        await writer.callWriter(() => note.archive()) // `archive` is a @writer on Note
      }
    }, 'notes.archiveAll')
  }
}
```

Calling another writer without `callWriter` deadlocks. See
[nesting writers or readers](../Writers.md#advanced-nesting-writers-or-readers).

Methods that only build a `Query` (like `pinned()` above) don't need a decorator. Queries aren't
run until you `fetch()` or `observe()` them.

## The constructor

NitromelonDB constructs your class as `new NoteCollection(database, Note)`. If you override the
constructor, accept both arguments and pass them to `super`:

```js
class NoteCollection extends Collection {
  constructor(database, modelClass) {
    super(database, modelClass)
    // your setup
  }
}
```

There is exactly one instance per table per `Database`, so instance fields are shared by everything
that uses that table. That makes it a reasonable place for table-wide in-memory state, but don't
store anything per-record there.

## TypeScript

`database.get()` is typed as returning `Collection<T>`, so cast to your class to see its methods:

```ts
class NoteCollection extends Collection<Note> {
  @writer async createNote(title: string, body: string): Promise<Note> {
    return this.create((note) => {
      note.title = title
      note.body = body
    })
  }
}

const notes = database.get(Note) as NoteCollection
```

Define `NoteCollection` before `Note` (or in its own file) so it's in scope when
`static associatedCollectionClass = NoteCollection` runs. `NoteCollection` only refers to `Note` as
a type, so there's no runtime import cycle.
