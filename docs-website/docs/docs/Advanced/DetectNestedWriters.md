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

When it is on, a nested `database.write()` / `database.read()` (or `@writer` / `@reader`) without `callWriter()` / `callReader()` **throws as soon as the outer writer waits for it**. That's the call that would hang forever.

## What is detected

A nested call throws if the outer writer/reader waits for it, **no matter how many unrelated `await`s come first**:

```js
// Same JS turn
database.write(async () => {
  await nested() // nested is database.write(...) without callWriter
})

// After any await: network, timers, helpers, Watermelon queries...
database.write(async () => {
  await fetch(url)
  await delay(100)
  await tasks.find(task.id)
  await nested()
})

// Deep inside helpers the writer awaits
const save = async () => {
  await somethingElse()
  return database.write(() => tasks.create()) // nested, two calls down
}
database.write(async () => {
  await save()
})

// Returned, or chained with .then(), instead of awaited: still waiting for it
database.write(async () => {
  await fetch(url)
  return nested()
})
```

The error looks like:

```
Nested writer (nested writer) called from writer (outer writer) without callWriter()/callReader(). This deadlocks.
```

The nested writer is removed from the queue and never runs, so the outer writer can catch the error and carry on.

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

**Fire-and-forget writers still queue.** A nested writer the outer one *doesn't* wait for doesn't deadlock. It runs after the outer writer finishes, same as with the flag off:

```js
database.write(async () => {
  await saveLocally()
  database.write(() => markDirty()) // not awaited: queued, runs after this writer
})
```

**Observers can react with their own writers.** A subscriber that starts a writer when a writer's changes come in isn't nested, even if it fires while that writer is still running.

## How it works, per platform

To tell a nested call from an independent one, NitromelonDB has to know which writer a piece of code belongs to, across `await`s. JavaScript has no standard way to do that yet (TC39 `AsyncContext` is still a proposal), so the flag uses the best mechanism the engine offers:

| Where | Mechanism | Coverage |
| --- | --- | --- |
| Node, Jest, Electron main | `AsyncLocalStorage` | Every `await`, timer and callback started by the writer |
| Engines with TC39 `AsyncContext` | `AsyncContext.Variable` | Same |
| React Native (Hermes), browsers | `Promise.prototype.then` is wrapped while the flag is on, Zone.js-style | Every `await` and `.then()` chain when async functions are compiled to promises (React Native's default Babel setup), plus natively executed `await` on Hermes (verified with Hermes V1, React Native 0.86) |

Because of the first row, a forgotten `callWriter()` is caught in your Jest tests whatever platform the app ships on. Turning the flag on in your test setup is a cheap way to catch it in CI.

## Caveats (flag on)

### Browsers with native `await`

Modern browsers run `async` functions natively, and resuming after a native `await` doesn't call `.then()`. There, after an unrelated `await`, detection falls back to the older heuristic: the same JS turn, and right after a Watermelon call (`find`, `query` / `fetch` / `fetchCount` / `fetchIds` / `unsafeFetchRaw`, `create`, `update`, `batch`). In that heuristic window a fire-and-forget nested write also throws, because the heuristic can't tell whether it will be awaited.

### Callbacks the writer hands to non-promise APIs

On React Native and in browsers, a nested write made *inside* a plain callback the writer registered (`setTimeout(cb)`, an event listener) isn't followed, even if the writer awaits a promise that callback resolves:

```js
database.write(async () => {
  await delay(100)
  await nested() // followed: throws

  await new Promise(resolve =>
    setTimeout(async () => {
      await nested() // not followed on RN/browsers: deadlocks
      resolve()
    }, 100),
  )
})
```

On Node (and so in Jest) both are caught.

### Development and tests

The flag wraps `Promise.prototype.then` on React Native and in browsers. It costs one extra function call per `.then()` app-wide, plus a small closure while a writer is running. That's fine in development and tests, but there's no reason to ship it to production.

## See also

- [Writers: nesting writers or readers](../Writers.md#advanced-nesting-writers-or-readers)
