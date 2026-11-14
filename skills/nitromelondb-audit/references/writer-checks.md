# Writer and reader checks

Docs: [Writers, Readers, Batching](https://stasdoskalenko.github.io/NitromelonDB/docs/Writers.md), [Detect nested writers](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/DetectNestedWriters.md), [Observability](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Observability.md), [Hooks](https://stasdoskalenko.github.io/NitromelonDB/docs/Hooks.md)

Readers and writers share one queue, and only one runs at a time. Most problems here follow from that.

## W1. Nested writer or reader without `callWriter()` / `callReader()`

A writer started from inside a running writer is queued behind it. If the outer one waits for it (`await`, `return`, `.then()`), neither ever finishes. The app hangs with no error.

How to find it, using the entry-point lists from step 1 of the audit:

1. For each writer body (a `@writer` method, or the callback of `database.write(...)`, `useWriter`), collect every call it waits for.
2. Flag a call if its target is in the writer or reader entry-point lists: another `@writer` / `@reader` method, a function that calls `database.write()` / `database.read()`, or a direct `database.write()` / `database.read()`.
3. Follow plain helper functions the writer awaits, a few levels deep. A helper that itself awaits a writer is the same bug, two calls down.
4. Do the same for reader bodies.

Not a finding:

- The call is wrapped: `this.callWriter(() => other.method())`, `writer.callWriter(() => ...)`, `reader.callReader(() => ...)`.
- The nested writer isn't waited for (fire and forget). It runs after the outer one. Mention it only if the code clearly expects it to have finished.
- `collection.create()`, `record.update()`, `database.batch()`, `query.fetch()` inside a writer. Those aren't writers, they're the work a writer does.
- A second `database.write()` started independently, from the UI or another event, while one is running. It waits its turn.

Easy to miss:

- A `@writer` on a model calling a `@writer` on a related model (`post.appendToBody()` from `Comment`).
- An overridden `markAsDeleted()` / `destroyPermanently()` that calls a `@writer`.
- A service function used both standalone and from inside writers, which wraps itself in `database.write()`.
- `useWriter(model, async (model) => { await model.someWriterMethod() })`: the hook already runs the callback inside a writer.

Fix: wrap the nested call in `callWriter()` / `callReader()`. Or move the shared logic into a plain function that takes the work as part of the caller's writer, and keep one thin `@writer` wrapper for standalone use.

## W2. `synchronize()` inside a writer or reader

`synchronize()` runs its own readers and writers. Called and awaited from inside `database.write()` or a `@writer`, it deadlocks the same way as W1. Call it outside any writer.

## W3. Slow, unrelated work inside a writer

While a writer runs, every other write in the app waits, including sync and anything the user taps. Flag these inside writer bodies:

- Network requests: `fetch`, axios, GraphQL clients, uploads.
- Timers and delays.
- File system or image processing.
- Waiting for user input (an alert with a promise, a modal).
- Heavy loops that don't touch the database.

Fix: do the slow part first, outside the writer, and open the writer only to store the result. In development a writer that blocks another for about 1.5 s logs a warning naming both.

For the common "set a few fields on one record" case from a component, `useAtomicWriter` can't contain slow work at all.

## W4. Unbatched writes

Several awaited `create()` / `update()` / `markAsDeleted()` / `destroyPermanently()` calls in one writer, and above all inside a `for` loop or `Promise.all(records.map(...))`, each make their own trip to the database and notify observers each time.

Fix: prepare, then batch once.

```js
await database.write(async () => {
  await database.batch(
    post.prepareUpdate(p => {
      p.title = title
    }),
    ...comments.map(comment => comment.prepareMarkAsDeleted()),
    commentsCollection.prepareCreate(c => {
      c.post.set(post)
    }),
  )
})
```

`batch()` takes a list or one array, and ignores falsy values. Inside a `@writer` use `this.batch(...)`.

Severity: Medium for loops over data of unknown size (imports, "mark all as read"), Low for two or three fixed calls.

## W5. Missing `await`, or a non-async writer

- `collection.create()`, `record.update()`, `database.batch()`, `markAsDeleted()` without `await` inside a writer: the writer can finish before the work does, and errors become unhandled rejections.
- The function passed to `database.write()` / `database.read()` must be async (or return a promise).
- The builder passed to `create()` / `update()` / `prepareCreate()` / `prepareUpdate()` must be **synchronous**. `async` or `await` inside it throws.

## W6. Changes outside a writer

- `create`, `update`, `batch`, `markAsDeleted`, `destroyPermanently` called outside `database.write()` / `@writer` / `useWriter`: throws at runtime. Often hidden in a code path tests don't cover.
- A field assigned outside a builder (`post.title = 'x'` in a component or a service): throws.
- `record.id = ...` outside `create()` / `prepareCreate()`: throws. (`_raw.id` inside the create builder and `prepareCreateFromDirtyRaw` are fine.)
- A `prepareUpdate()` / `prepareCreate()` result that never reaches `batch()`, or reaches it in a later writer.

## W7. Deleting records one by one

`const all = await query.fetch(); for (...) await record.destroyPermanently()` loads every record to delete it. Use `query.markAllAsDeleted()` (synced apps) or `query.destroyAllPermanently()`.

Related, informational: a model with `@children` whose `markAsDeleted()` isn't overridden leaves the children behind when the parent is deleted. Mention it, the app may want that.

## W8. Descriptions on long writers

`database.write(fn, 'sync.pushChanges')` names the writer in the "stuck writer" warning and in nested-writer errors. `@writer` methods use the method name already. Suggest a description for inline writers that do a lot (imports, sync steps, bulk edits). Low.
