---
title: Detect nested writers (deadlock prevention)
hide_title: true
---

# Detect nested writers (deadlock prevention)

If you call a Writer from another Writer (or a Reader from a Reader/Writer) **without** `callWriter()` / `callReader()`, the inner work is queued behind the outer one. If you `await` that nested call, **neither ever finishes**.

`experimentalDetectNestedWriters` makes that fail fast instead of hanging.

This is **opt-in** and **off by default**. With the flag unset, nested writers still deadlock as they always have.

## Enable

Pass the flag when you create the database:

```js
const database = new Database({
  adapter,
  modelClasses: [
    // ...
  ],
  experimentalDetectNestedWriters: true,
})
```

When it is on, a nested `database.write()` / `database.read()` (or `@writer` / `@reader`) without `callWriter()` / `callReader()` **throws immediately**.

## What is detected

Detection covers two windows:

1. Nested calls on the **same JavaScript turn** — still running synchronously in the outer writer, before its first `await`.
2. Nested calls **after a Watermelon await** — `find`, `query` / `fetch` / `fetchCount` / `fetchIds` / `unsafeFetchRaw`, `create`, `update`, `batch`.

These throw:

```js
// Nested on the same JS turn
database.write(async () => {
  await nested() // nested is database.write(...) without callWriter
})

database.write(async () => {
  nested() // not even awaited — also throws (see caveats)
})

// Nested after a Watermelon await (including a cached find)
database.write(async () => {
  await tasks.find(task.id)
  await nested()
})
```

The error looks like:

```
Nested writer (nested writer) called from writer (outer writer) without callWriter()/callReader(). This deadlocks.
```

## What still works

**`callWriter` / `callReader` are exempt.** Legitimate nested work keeps running as part of the outer block, including after `await find()`:

```js
await database.write(async writer => {
  await tasks.find(task.id)
  return writer.callWriter(() => nested())
})
```

**Independent writers still queue.** A second `database.write()` started from the UI while another writer is awaiting (for example while sync is running) is **not** nested. It waits its turn as usual:

```js
const first = database.write(async () => {
  await tasks.find(task.id)
  await delay() // still the first writer; nothing nested
})
const second = database.write(async () => 'queued') // from the UI / another event
await first
await second // 'queued'
```

JavaScript is single-threaded. Those independent calls run as a later macrotask, not inside the outer writer's synchronous continuation, so they are not treated as nested.

## Caveats (flag on)

### Detection is best-effort

A nested write **after a non-Watermelon await** is not detected. That continuation is no longer known to be "inside" the writer:

```js
database.write(async () => {
  await fetch(url) // network / timer / anything that is not a Watermelon API
  await nested()   // still deadlocks; this flag will not throw
})
```

Only Watermelon adapter awaits (`find` / `query` / `batch` and the methods listed above) re-arm detection for the next turn.

### Fire-and-forget nested writes also throw

This does **not** technically deadlock — the un-awaited inner write would queue after the outer one finishes — but with the flag on it still throws:

```js
database.write(async () => {
  database.write(async () => {
    // ...
  })
})
```

Treat that as a forgotten nest. If the inner work belongs in this writer, use `callWriter`. If it should run later on its own, start it from outside the writer (for example from the UI).

## See also

- [Writers: nesting writers or readers](../Writers.md#advanced-nesting-writers-or-readers)
