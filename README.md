<p align="center">
  <img src="https://github.com/StasDoskalenko/NitromelonDB/raw/master/assets/logo-horizontal.png" alt="NitromelonDB" width="539" />
</p>

<p align="center">
  <strong>A reactive, offline-first SQLite database for React Native, Expo, the web, Windows and Node.</strong><br/>
  A maintained fork of WatermelonDB, on the React Native New Architecture.
</p>

<p align="center">
  <a href="https://github.com/StasDoskalenko/NitromelonDB/blob/master/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"/></a>
  <a href="https://www.npmjs.com/package/nitromelondb"><img src="https://img.shields.io/npm/v/nitromelondb.svg" alt="npm"/></a>
  <a href="https://discord.gg/aXqqy3HPb"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord"/></a>
</p>

<p align="center">
  <a href="https://stasdoskalenko.github.io/NitromelonDB/">Documentation</a> ·
  <a href="https://stasdoskalenko.github.io/NitromelonDB/docs/Installation">Installation</a> ·
  <a href="https://stasdoskalenko.github.io/NitromelonDB/docs/Migrating">Migrating from WatermelonDB</a> ·
  <a href="https://stasdoskalenko.github.io/NitromelonDB/performance">Performance</a> ·
  <a href="https://discord.gg/aXqqy3HPb">Discord</a>
</p>

NitromelonDB keeps your data in SQLite and loads only what a screen asks for, so apps with tens of thousands of records still launch fast. Records are observable: change one, and every component that shows it re-renders. It syncs with your own backend.

It continues [WatermelonDB](https://github.com/Nozbe/WatermelonDB) by [Nozbe](https://github.com/Nozbe), which hasn't kept up with React Native, iOS and Android for a while. Models, queries, writers and sync work the same way, and existing databases keep working. Coming from `@nozbe/watermelondb`? Follow the [migration guide](https://stasdoskalenko.github.io/NitromelonDB/docs/Migrating). (The original WatermelonDB introduction now lives in [LEGACY_README.md](https://github.com/StasDoskalenko/NitromelonDB/blob/master/LEGACY_README.md).)

## Install

```bash
# Expo (development build, EAS Build or EAS Update; not Expo Go)
npx expo install nitromelondb react-native-nitro-modules

# bare React Native
yarn add nitromelondb react-native-nitro-modules
```

Expo apps also add `"nitromelondb"` to `plugins` in `app.json`. Expo needs no Babel setup for decorators; bare React Native needs four Babel plugins. Then rebuild the native app. All steps, per platform: [Installation](https://stasdoskalenko.github.io/NitromelonDB/docs/Installation).

**Requirements:** React Native 0.83+ on the New Architecture, iOS 15.1+, Android minSdk 24, React Native Windows 0.84+, Node.js 22+ (for Node, Electron and tooling).

Using an AI coding agent? Point it at [llms.txt](https://stasdoskalenko.github.io/NitromelonDB/llms.txt) (an index of the docs as Markdown) or [llms-full.txt](https://stasdoskalenko.github.io/NitromelonDB/llms-full.txt) (all of it in one file). There are also [agent skills](https://stasdoskalenko.github.io/NitromelonDB/docs/AgentSkills) that migrate an app from WatermelonDB, audit its setup and find missing indexes: `npx skills add StasDoskalenko/NitromelonDB`.

## A quick look

Define models for the tables in your schema:

```ts
import { Model, Query } from 'nitromelondb'
import { children, field, text } from 'nitromelondb/decorators'

class Post extends Model {
  static table = 'posts'
  static associations = {
    comments: { type: 'has_many', foreignKey: 'post_id' },
  } as const

  @text('title') title!: string
  @field('is_pinned') isPinned!: boolean
  @children('comments') comments!: Query<Comment>
}
```

Then use them in components. They re-render when the data changes, wherever the change came from:

```tsx
import { useQuery, useRecord, useWriter } from 'nitromelondb/hooks'

function PostScreen({ post }: { post: Post }) {
  useRecord(post) // re-render when the post changes
  const comments = useQuery(post.comments) // ...or when its comments do
  const [togglePin, { isPending }] = useWriter(post, async (p) => {
    await p.update((record) => {
      record.isPinned = !record.isPinned
    })
  })

  return (
    <View>
      <Text>{post.title}</Text>
      <Button title={post.isPinned ? 'Unpin' : 'Pin'} onPress={() => togglePin()} disabled={isPending} />
      {comments.map((comment) => (
        <CommentRow key={comment.id} comment={comment} />
      ))}
    </View>
  )
}
```

Prefer higher-order components? `withObservables` still works. See [Components](https://stasdoskalenko.github.io/NitromelonDB/docs/Components) and [Hooks](https://stasdoskalenko.github.io/NitromelonDB/docs/Hooks).

## What's new since WatermelonDB

**Platforms**

- **New Architecture only.** Native SQLite on iOS, Android and Windows goes through [Nitro Modules](https://nitro.margelo.com). The old architecture (Paper and the legacy bridge) isn't supported.
- **Expo, first class.** A config plugin for development builds, EAS Build and EAS Update replaces `@morrowdigital/watermelondb-expo-plugin`. The example app runs on Expo SDK 58 and React Native 0.88.
- **Windows.** React Native Windows on the New Architecture (WinAppSDK), with the same Nitro SQLite.
- **The web, on real SQLite.** The same `nitromelondb/adapters/sqlite` import runs [wa-sqlite](https://stasdoskalenko.github.io/NitromelonDB/docs/Implementation/WaSQLiteAdapter) in a worker in the browser, and stores data in IndexedDB. No COOP/COEP headers needed.
- **Node.js and Electron.** SQLite through `better-sqlite3`, and `RemoteAdapter` to run it in Electron's main process.
- **Simpler installs.** SQLite and simdjson are compiled in. Autolinking is all you need: no Podfile, Gradle or `MainApplication` changes, and R8 keep rules ship with the library.

**For developers**

- **Written in TypeScript**, with strict checking, so the published types match the code.
- **Decorators, both kinds.** On Expo, model decorators work with no Babel setup at all. Standard (TC39) decorators with `accessor` fields work too, and development builds tell you when decorators compiled but don't work. See [Decorators](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/StandardDecorators).
- **Hooks:** `useQuery`, `useRecord`, `useObservable`, `useWriter`, `useAtomicWriter` and `useDatabaseReady`, next to `withObservables`.
- **Seeding and readiness:** `new Database({ seed })` for initial or demo data tied to schema versions, and `database.readyPromise` / `useDatabaseReady` to gate your UI on setup.
- **Smaller conveniences:** `database.get(Post)` with a model class, `findAndObserveOrNull(id)`, and raw SQL expressions in `Q.sortBy`.
- **Observability:** nested writers, stuck readers and writers, and wrong `callWriter` / `callReader` use fail loudly and say where, instead of hanging. See [Observability](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Observability).

**Performance**

Measured against WatermelonDB 0.28 on the same device, with the same benchmark apps (v0.32.0-beta.0, iPhone 18 Pro simulator, Release builds, React Native 0.88; [method and raw data](./examples/benchmark#latest-results-2026-11-08-v0320-beta0-ios-simulator)):

| | vs WatermelonDB with JSI | vs WatermelonDB without JSI |
| --- | --- | --- |
| Initial sync of a fresh install (80 tables, 300 pulls) | **2.0× faster** | **4.7× faster** |
| Many small syncs into existing data (67 pulls, 12 tables) | **1.4× faster** | **2.3× faster** |
| Sync of 5,000 / 20,000 records (create, update, fetch, push) | **1.2× / 1.2× faster** | **1.9× / 2.1× faster** |
| Sync of 50,000 records (initial and update pulls) | **1.6× faster** | **2.4× faster** |
| Bulk writes and deletes (100,000 records × 10) | **1.4× faster** | **2.1× faster** |

A single query returning ~50,000 records right after syncing them is faster too: 1.2× faster than WatermelonDB with JSI when the app sat idle before the sync, and 4.3× when the sync runs right at launch, where WatermelonDB spends most of that query in garbage collection. One thing is slower: the stress test's query phase, 10% against WatermelonDB without JSI (level with JSI).

What makes it faster:

- Query results skip Nitro's generic `AnyMap` conversion on the way to JS, and the native statement cache is a bounded LRU.
- Sync skips tables with nothing to pull and finds tables with local changes in one query; large batches no longer rebuild every index.
- `destroyAllPermanently()` and `markAllAsDeleted()` no longer slow down with the number of records.
- Caches trim themselves when the OS reports memory pressure, and SQLite releases its own memory too.

The NotesApp's Android CPU, memory and frame rate are also tracked on every commit: [Performance](https://stasdoskalenko.github.io/NitromelonDB/performance).

**Tested on every pull request**

- The shared correctness suite (CRUD, queries, migrations, concurrent writers, batches) runs against the real native SQLite bridge on iOS and Android.
- The [NotesApp](./examples/NotesApp) runs end-to-end tests on every platform: [Maestro](https://docs.maestro.dev) flows on iOS and Android (cold start, create / pin / delete, kill-and-relaunch, pagination, sync), the same scenarios except sync through WinAppDriver on Windows, and Playwright on the web.
- Sync runs end to end against a [reference sync server](./examples/sync-server), on SQLite and LokiJS.

Full history: [changelog](https://stasdoskalenko.github.io/NitromelonDB/docs/CHANGELOG).

## Example apps

- **[NotesApp](./examples/NotesApp):** a notes list with migrations, pagination and sync, on Expo for iOS, Android and the web.
- **[NotesApp_windows](./examples/NotesApp_windows):** the same app on React Native Windows. It's a separate app because RNW 0.85 is on React Native 0.85.
- **[benchmark](./examples/benchmark):** NitromelonDB and WatermelonDB side by side, measuring the same operations.
- **[sync-server](./examples/sync-server):** a small sync backend in TypeScript (Hono and SQLite) to copy from.

Each folder's README has run instructions.

## Roadmap

[SQLCipher](https://github.com/StasDoskalenko/NitromelonDB/issues/60) (including existing databases), [VACUUM](https://github.com/StasDoskalenko/NitromelonDB/issues/59), [macOS](https://github.com/StasDoskalenko/NitromelonDB/issues/49), [paginated sync](https://github.com/StasDoskalenko/NitromelonDB/issues/50), [more reliable migrations](https://github.com/StasDoskalenko/NitromelonDB/issues/57) and [clearer critical-error handling](https://github.com/StasDoskalenko/NitromelonDB/issues/61).

## Contributing

NitromelonDB is open source and needs your help. If something's missing or broken, open an issue to talk it through, and see the [contributing guide](./CONTRIBUTING.md) for setup and testing. [Good first issues](https://github.com/StasDoskalenko/NitromelonDB/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) are a nice place to start.

Building an app with NitromelonDB? Let us know on [Discord](https://discord.gg/aXqqy3HPb), or add your logo to [LEGACY_README.md](https://github.com/StasDoskalenko/NitromelonDB/blob/master/LEGACY_README.md#who-uses-watermelondb).

## Credits and license

**WatermelonDB** was created by [@Nozbe](https://github.com/Nozbe), and its main author is [Radek Pietruszewski](https://github.com/radex). Huge thanks to them and to the [original contributors](https://github.com/Nozbe/WatermelonDB/graphs/contributors) for designing and building it.

**NitromelonDB** is maintained by [Stas Doskalenko](https://github.com/StasDoskalenko).

MIT licensed. See [LICENSE](https://github.com/StasDoskalenko/NitromelonDB/blob/master/LICENSE).
