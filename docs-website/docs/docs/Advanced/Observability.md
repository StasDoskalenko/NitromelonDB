---
title: Observability
hide_title: true
---

# Observability

NitromelonDB sits on the hot path of enterprise apps. When a writer never finishes, a reader is nested the wrong way, or the queue is stuck, engineers need a **named failure** — not a frozen UI.

This page is the map. Use it in production debugging and when you turn on stricter checks in development.

## Nested writers and deadlocks

Readers and writers are a single queue. Calling `database.write()` / `database.read()` (or `@writer` / `@reader`) from inside an already running block **without** `callWriter()` / `callReader()` does not nest. It waits for the outer block to finish — and the outer block is waiting for the inner one. That is a deadlock.

**Turn on detection in development (and staging):**

```js
const database = new Database({
  adapter,
  modelClasses: [/* ... */],
  experimentalDetectNestedWriters: true,
})
```

When the flag is on, a nested call throws immediately instead of hanging:

```
Nested writer (nested writer) called from writer (outer writer) without callWriter()/callReader(). This deadlocks.
```

The correct nest:

```js
await database.write(async writer => {
  await writer.callWriter(() => post.appendToBody('…'))
})
```

Independent writers started from the UI (for example while sync is running) still **queue**. That is not a nest and is not a deadlock.

Details, what the flag does and does not catch: **[Detect nested writers](./DetectNestedWriters.md)**. Nesting API: **[Writers](../Writers.md#advanced-nesting-writers-or-readers)**.

## Stuck readers and writers

In development, if a reader or writer sits behind another for more than ~1.5s, NitromelonDB logs a warning:

- which work is **running**
- which work is **queued**
- that a stuck current reader/writer is why later work is not running
- that nested calls must use `callReader()` / `callWriter()`

If the current writer is waiting on `fetch()`, a lock, or another database call that never resolves, this warning is the first place to look. Give writers a `description` so the log names the work:

```js
await database.write(async writer => {
  // …
}, 'sync.pushChanges')
```

`@writer` / `@reader` methods use the method name as that description.

## Logging

By default NitromelonDB logs adapter setup and query timing. Route `log` / `warn` / `error` into your APM or log pipeline (Sentry, Datadog, and similar) so production incidents include database context:

```js
import logger from 'nitromelondb/utils/common/logger'

logger.warn = (...messages) => yourLogger.warn(...messages)
logger.error = (...messages) => yourLogger.error(...messages)
```

Full API: **[Logging](./Logging.md)**.

## Setup checklist

- Enable `experimentalDetectNestedWriters` in non-production builds (see [Setup](../Setup.md)).
- Pass a `description` on long `database.write()` / `database.read()` blocks (sync, imports, migrations).
- Forward the NitromelonDB logger into the same system you use for app errors.
- When a screen hangs on a write, read the nested-writer throw or the queue warning before assuming SQLite is slow.
