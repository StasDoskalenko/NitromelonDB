---
title: Detect nested writers (deadlock prevention)
hide_title: true
---

# Detect nested writers (deadlock prevention)

If you call a Writer from another Writer (or a Reader from a Reader/Writer) **without** `callWriter()` / `callReader()`, the inner work is queued behind the outer one. If you `await` that nested call, **neither ever finishes**.

`experimentalDetectNestedWriters` makes that fail fast instead of hanging.

This is **opt-in** and **off by default**. With the flag unset, nested writers still deadlock as they always have. It's meant for development and tests, not production builds (see [Performance](#performance)).

## Enable

Pass the flag when you create the database, in development builds only:

```js
const database = new Database({
  adapter,
  modelClasses: [
    // ...
  ],
  experimentalDetectNestedWriters: __DEV__,
})
```

`__DEV__` is defined by React Native (and Expo web). With another web bundler, use `process.env.NODE_ENV !== 'production'`. In Jest, turn it on unconditionally in your test setup; that's where it's free.

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

## Performance

With the flag off, nothing is installed and there's no cost.

With the flag on, Node and Jest use `AsyncLocalStorage`, which showed no measurable cost. On React Native and in browsers the flag wraps `Promise.prototype.then` for the whole app. Measured on Hermes (iOS simulator, median of 5 runs):

| Workload | Flag off | Flag on | |
| --- | --- | --- | --- |
| 50k `await`s, no writer running | 18 ms | 21 ms | 1.12x |
| 50k `await`s inside one writer | 18 ms | 30 ms | 1.68x |
| 200 writers × (batch of 10 creates + count) | 63 ms | 65 ms | 1.00–1.02x |
| 2,000 tiny writers | 5 ms | 5 ms | ~1.1x |
| 1,000 `fetchCount` reads | 132 ms | 132 ms | ~1.00x |

That's about 0.05 µs extra per `await` outside writers and 0.25 µs inside one. Once a writer does real database work the difference is within noise.

It still doesn't belong in production builds:

- It replaces `Promise.prototype.then` globally. Other code that wraps or inspects `then` (Zone.js-style tools, some error trackers) could interact with it.
- A promise callback created inside a writer keeps that writer's context after the writer finishes. A long-running loop started from a writer and never awaited keeps paying the in-writer cost. It can't cause false errors: detection only compares against the writer that's currently running.
- It turns a hang into an error you can see while developing. A forgotten `callWriter()` should be caught by your tests before it ships.

## See also

- [Writers: nesting writers or readers](../Writers.md#advanced-nesting-writers-or-readers)
