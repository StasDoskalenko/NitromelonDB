# Create, Read, Update, Delete

When you have your [Schema](./Schema.md) and [Models](./Model.md) defined, learn how to manipulate them!

## Reading

#### Get a collection

The `Collection` object is how you find, query, and create new records of a given type.

```js
const postsCollection = database.get('posts')
```

Pass the [table name](./Schema.md) as the argument.

#### Find a record (by ID)

```js
const postId = 'abcdefgh'
const post = await database.get('posts').find(postId)
```

`find()` returns a Promise. If the record cannot be found, the Promise will be rejected.

#### Query records

Find a list of records matching given conditions by making a Query and then fetching it:

```js
const allPosts = await database.get('posts').query().fetch()
const numberOfStarredPosts = await database.get('posts').query(
  Q.where('is_starred', true)
).fetchCount()
```

**➡️ Learn more:** [Queries](./Query.md)

## Modifying the database

All modifications to the database (like creating, updating, deleting records) must be done **in a Writer**, either by wrapping your work in `database.write()`:

```js
await database.write(async () => {
  const someComment = await database.get('comments').find(commentId)
  await someComment.update((comment) => {
    comment.isSpam = true
  })
})
```

Or by defining a `@writer` method on a Model:

```js
import { writer } from 'nitromelondb/decorators'

class Comment extends Model {
  // (...)
  @writer async markAsSpam() {
    await this.update(comment => {
      comment.isSpam = true
    })
  }
}
```

**➡️ Learn more:** [Writers](./Writers.md)

### Create a new record

```js
const newPost = await database.get('posts').create(post => {
  post.title = 'New post'
  post.body = 'Lorem ipsum...'
})
```

`.create()` takes a "builder function". In the example above, the builder will get a `Post` object as an argument. Use this object to set values for [fields you defined](./Model.md).

**Note:** Always `await` the Promise returned by `create` before you access the created record.

**Note:** You can only set fields inside `create()` or `update()` builder functions.

### Update a record

```js
await somePost.update(post => {
  post.title = 'Updated title'
})
```

Like creating, updating takes a builder function, where you can use field setters.

**Note:** Always `await` the Promise returned by `update` before you access the modified record.

### Delete a record

There are two ways of deleting records: syncable (mark as deleted), and permanent.

If you only use Watermelon as a local database, destroy records permanently, if you [synchronize](./Sync/Intro.md), mark as deleted instead.

```js
await somePost.markAsDeleted() // syncable
await somePost.destroyPermanently() // permanent
```

**Note:** Do not access, update, or observe records after they're deleted.

## Advanced

- `Model.observe()` - usually you only use this [when connecting records to components](./Components.md), but you can manually observe a record outside of React components. The returned [RxJS](https://github.com/reactivex/rxjs) `Observable` will emit the record immediately upon subscription, and then every time the record is updated. If the record is deleted, the Observable will complete.
- `Query.observe()`, `Relation.observe()` — analagous to the above, but for [Queries](./Query.md) and [Relations](./Relation.md)
- `Query.observeWithColumns()` - used for [sorted lists](./Components.md)
- `Collection.findAndObserve(id)` — same as using `.find(id)` and then calling `record.observe()`
- `Model.prepareUpdate()`, `Collection.prepareCreate`, `Database.batch` — used for [batch updates](./Writers.md)
- `Database.unsafeResetDatabase()` destroys the whole database - [be sure to see this comment before using it](https://github.com/Nozbe/WatermelonDB/blob/22188ee5b6e3af08e48e8af52d14e0d90db72925/src/Database/index.js#L131)
- To override the `record.id` during creation (for example to match a server id), assign `record.id` inside `create()` / `prepareCreate()`. The id must be a non-empty string. Assigning `id` after create throws.
    ```js
    await database.get('posts').create(post => {
      post.id = serverId
    })
    ```
    `post._raw.id = serverId` and `collection.prepareCreateFromDirtyRaw({ id: serverId, ... })` still work.

### Logging out / switching users

Most apps use a single, long-lived `Database` instance and, on logout, either call `database.unsafeResetDatabase()` or drop down to raw SQL/adapter calls to wipe every table. Either way, **the safe pattern is to make sure nothing is still observing the database when you do this**:

- `unsafeResetDatabase()` clears each `Collection`'s internal record cache, but it does not — and cannot — reach into every `Query`/`Model` observer your app may still be holding onto. Its own doc comment says so explicitly: you must not hold onto records, collections, or other Watermelon objects, and all observers/subscribers should be disposed of first.
- If a subscription genuinely stays alive across the reset (a persistent top-level component, a memoized `Query` held in module scope, a `useQuery`/`useModel`/`withObservables`-connected component that didn't unmount), NitromelonDB now detects and self-heals it: any `Query` cache (`.observe()`, `.observeWithColumns()`, `.observeCount()`, and their Rx-free `experimentalSubscribe*()` equivalents) that's still actively subscribed when `unsafeResetDatabase()` runs is invalidated and immediately refetched, so the subscriber gets fresh (post-reset) data instead of being frozen on the previous user's data forever. This is a safety net for a real app bug, not a substitute for tearing subscriptions down properly — until that invalidation runs, the still-mounted component *will* briefly render the old user's data.
- **If you wipe tables yourself instead of calling `unsafeResetDatabase()`** (raw SQL, `unsafeExecute`, or anything else that bypasses `database.write()`/`collection.create()`/etc.), that automatic invalidation doesn't run — nothing told NitromelonDB the data changed. Call `database.resetObservablesCache()` (or the narrower `collection.resetObservablesCache()`, for just one table) yourself right after, inside the same writer. Any singleton/long-lived observer watching that data — including ones that are correctly still subscribed across your logout/login — picks up the new (or new user's) data instead of breaking or going stale.
- The cleanest option, if your app's shape allows it, is to give each logged-in session its own `Database` instance (e.g. a fresh SQLite file per user, or just `new Database(...)`) instead of resetting a shared one — there's no cache to invalidate if nothing outlives the session in the first place.

### Advanced: Unsafe raw execute

⚠️ Do not use this if you don't know what you're doing...

There is an escape hatch to drop down from WatermelonDB to underlying database level to execute arbitrary commands. Use as a last resort tool. **Watermelon's Query/Model observers don't see these changes on their own** — follow up with `database.resetObservablesCache()` (see [logging out / switching users](#logging-out--switching-users)) if anything might be observing the tables you touched:

```js
await database.write(() => {
  // sqlite:
  await database.adapter.unsafeExecute({
    sqls: [
      // [sql_query, [placeholder arguments, ...]]
      ['create table temporary_test (id, foo, bar)', []],
      ['insert into temporary_test (id, foo, bar) values (?, ?, ?)', ['t1', true, 3.14]],
    ]
  })

  // lokijs:
  await database.adapter.unsafeExecute({
    loki: loki => {
      loki.addCollection('temporary_test', { unique: ['id'], indices: [], disableMeta: true })
      loki.getCollection('temporary_test').insert({ id: 't1', foo: true, bar: 3.14 })
    }
  })
})
```

* * *

## Next steps

➡️ Now that you can create and update records, [**connect them to React components**](./Components.md)

