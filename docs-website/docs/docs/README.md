---
title: Check out the README
hide_title: true
---

<table>
<tr>
<td>

## ℹ️ NitromelonDB is a fork of WatermelonDB

**[WatermelonDB](https://github.com/Nozbe/WatermelonDB)** (`@nozbe/watermelondb`) has not been updated in a while. React Native, iOS, and Android keep moving — New Architecture, yearly OS releases, new JS runtimes — and a reactive database that sits on native SQLite has to move with them.

**NitromelonDB** continues that work. Same lazy, observable, SQLite-backed model you already know; a codebase we can keep evolving.

**Why this fork exists**

- **Upstream is quiet.** Apps still need the library to track frequent React Native, iOS, and Android version changes.
- **New Architecture only.** Native SQLite on iOS and Android goes through [Nitro Modules](https://nitro.margelo.com). The old React Native architecture (Paper / the legacy bridge) is not supported.
- **One TypeScript codebase.** Implementation lives in TypeScript. That removes the standalone `.d.ts` layer, so types and runtime cannot drift and maintenance stays simpler.
- **Observability.** Nested writers, stuck readers, and incorrect `callWriter`/`callReader` usage should fail loudly so engineers can see *where* — not hang in production. See [Observability](./Advanced/Observability.md).
- **Performance.** We want to keep improving SQLite, native, and JS performance. The TypeScript rewrite is one step on that path (including future runtimes such as Static Hermes), alongside further native optimizations.
- **Same product, new package name.** Install `nitromelondb` and import from `nitromelondb` (not `@nozbe/watermelondb`). Step-by-step: **[Migrating from WatermelonDB](https://stasdoskalenko.github.io/NitromelonDB/docs/Migrating)**.

```bash
yarn add nitromelondb
# or: npm install nitromelondb
```

On Expo, add `"nitromelondb"` to the `plugins` array in `app.json` (development builds, EAS Build, and EAS Update). See [Installation](https://stasdoskalenko.github.io/NitromelonDB/docs/Installation#expo).

```js
import { Database } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
```

Full credit to [@Nozbe](https://github.com/Nozbe) and [Radek Pietruszewski](https://github.com/radex) for designing and shipping the original WatermelonDB.

</td>
</tr>
</table>

### ➡️ **Learn more:** [see full documentation](./Installation.mdx)

<p align="center">
  <img src="/img/nitromelon-icon.png" alt="NitromelonDB" width="220" />
</p>

<h4 align="center">
  NitromelonDB — a reactive database framework
</h4>

<p align="center">
  Build powerful React and React Native apps that scale from hundreds to tens of thousands of records and remain <em>fast</em> ⚡️
</p>

<p align="center">
  <a href="https://github.com/StasDoskalenko/NitromelonDB/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"/>
  </a>

  <a href="https://www.npmjs.com/package/nitromelondb">
    <img src="https://img.shields.io/npm/v/nitromelondb.svg" alt="npm"/>
  </a>
</p>

|   | NitromelonDB |
| - | ------------ |
| ⚡️ | **Launch your app instantly** no matter how much data you have |
| 📈 | **Highly scalable** from hundreds to tens of thousands of records |
| 😎 | **Lazy loaded**. Only load data when you need it |
| 🔄 | **Offline-first.** [Sync](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs-website/docs/docs/Sync/Intro.md) with your own backend |
| 📱 | **Multiplatform**. iOS, Android, Windows, web, Node.js, and **Expo** (EAS Build and EAS Update) |
| ⚛️ | **Optimized for React.** Easily plug data into components |
| 🧰 | **Framework-agnostic.** Use JS API to plug into other UI frameworks |
| ⏱ | **Fast.** And getting faster with every release! |
| ✅ | **Proven.** Powers [Nozbe](https://nozbe.com/teams) since 2017 (and [many others](#who-uses-watermelondb)) |
| ✨ | **Reactive.** (Optional) [RxJS](https://github.com/ReactiveX/rxjs) API |
| 🔗 | **Relational.** Built on rock-solid [SQLite](https://www.sqlite.org) foundation |
| ⚠️ | **Static typing** with [TypeScript](https://typescriptlang.org) |

## Why Watermelon?

**WatermelonDB** (and this fork) is a different way of dealing with user data in React Native and React web apps.

It's optimized for building **complex applications** in React Native, and the number one goal is **real-world performance**. In simple words, _your app must launch fast_.

For simple apps, using Redux or MobX with a persistence adapter is the easiest way to go. But when you start scaling to thousands or tens of thousands of database records, your app will now be slow to launch (especially on slower Android devices). Loading a full database into JavaScript is expensive!

Watermelon fixes it **by being lazy**. Nothing is loaded until it's requested. And since all querying is performed directly on the rock-solid [SQLite database](https://www.sqlite.org/index.html) on a separate native thread, most queries resolve in an instant.

But unlike using SQLite directly, Watermelon is **fully observable**. So whenever you change a record, all UI that depends on it will automatically re-render. For example, completing a task in a to-do app will re-render the task component, the list (to reorder), and all relevant task counters. [**Learn more**](https://www.youtube.com/watch?v=UlZ1QnFF4Cw).

| <a href="https://www.youtube.com/watch?v=UlZ1QnFF4Cw"><img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/watermelon-talk-thumbnail.jpg" alt="React Native EU: Next-generation React Databases" width="300" /></a> |
| ---- |
| <p align="center"><a href="https://www.youtube.com/watch?v=UlZ1QnFF4Cw">📺 <strong>Next-generation React databases</strong><br/>(a talk about WatermelonDB)</a></p> |

## Usage

**Quick (over-simplified) example:** an app with posts and comments.

First, you define Models:

```js
class Post extends Model {
  @field('name') name
  @field('body') body
  @children('comments') comments
}

class Comment extends Model {
  @field('body') body
  @field('author') author
}
```

Then, you connect components to the data:

```js
const Comment = ({ comment }) => (
  <View style={styles.commentBox}>
    <Text>{comment.body} — by {comment.author}</Text>
  </View>
)

// This is how you make your app reactive! ✨
const enhance = withObservables(['comment'], ({ comment }) => ({
  comment,
}))
const EnhancedComment = enhance(Comment)
```

And now you can render the whole Post:

```js
const Post = ({ post, comments }) => (
  <View>
    <Text>{post.name}</Text>
    <Text>Comments:</Text>
    {comments.map(comment =>
      <EnhancedComment key={comment.id} comment={comment} />
    )}
  </View>
)

const enhance = withObservables(['post'], ({ post }) => ({
  post,
  comments: post.comments
}))
```

The result is fully reactive! Whenever a post or comment is added, changed, or removed, the right components **will automatically re-render** on screen. Doesn't matter if a change occurred in a totally different part of the app, it all just works out of the box!

## Who uses WatermelonDB

  <a href="https://nozbe.com/?c=watermelon">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/nozbe.png" alt="Nozbe Teams" width="300" />
  </a>

  <br/>

  <a href="https://capmo.de">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/capmo.png" alt="CAPMO" width="300" />
  </a>

  <br/>

  <a href="https://mattermost.com/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/mattermost.png" alt="Mattermost" width="300" />
  </a>

  <br/>

  <a href="https://rocket.chat/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/rocketchat.png" alt="Rocket Chat" width="300" />
  </a>

  <br/>

  <a href="https://steady.health">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/steady.png" alt="Steady" width="150"/>
  </a>

  <br/>

  <a href="https://aerobotics.com">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/aerobotics.png" alt="Aerobotics" width="300" />
  </a>

  <br/>

  <a href="https://smashappz.com">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/smashappz.jpg" alt="Smash Appz" width="300" />
  </a>

  <br/>

  <a href="https://halogo.com.au/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/halogo_logo.png" alt="HaloGo" width="300" />
  </a>

  <br/>

  <a href="https://sportsrecruits.com/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/sportsrecruits-logo.png" alt="SportsRecruits" width="300" />
  </a>

  <br/>

  <a href="https://chatable.io/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/chatable_logo.png" alt="Chatable" width="300" />
  </a>

  <br/>

  <a href="https://todorant.com/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/todorant-logo.png" alt="Todorant" width="300" />
  </a>

  <br/>

  <a href="https://blastworkout.app/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/blastworkout-logo.png" alt="Blast Workout" width="300" />
  </a>

  <br/>

  <a href="https://dayful.app/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/dayful.png" alt="Dayful" width="300" />
  </a>

  <br/>

  <a href="https://learnthewords.app/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/learn-the-words.png" alt="Learn The Words" width="300" />
  </a>

  <br/>

  <a href="https://ezypack.app/">
    <img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/apps/ezypack.png" alt="ezypack" width="300" />
  </a>

  <br/>

_These apps were built on WatermelonDB. Does your company or app use NitromelonDB (or WatermelonDB)? Open a pull request and add your logo/icon with link here!_

## Contributing

<img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/needyou.jpg" alt="We need you" width="220" />

**NitromelonDB is an open-source project and it needs your help to thrive!**

If there's a missing feature, a bug, or other improvement you'd like, we encourage you to contribute! Feel free to open an issue to get some guidance and see [Contributing guide](./CONTRIBUTING.md) for details about project setup, testing, etc.

If you're just getting started, see [good first issues](https://github.com/StasDoskalenko/NitromelonDB/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) that are easy to contribute to.

If you make or are considering making an app using NitromelonDB, please let us know!

## Author and license

**WatermelonDB** was created by [@Nozbe](https://github.com/Nozbe).

**WatermelonDB's** main author is [Radek Pietruszewski](https://github.com/radex) ([website](https://radex.io) ⋅ [𝕏 (Twitter)](https://twitter.com/radexp)).

**NitromelonDB** is a maintained fork by [Stas Doskalenko](https://github.com/StasDoskalenko).

[Original WatermelonDB contributors](https://github.com/Nozbe/WatermelonDB/graphs/contributors).

NitromelonDB is available under the MIT license. See the [LICENSE file](https://github.com/StasDoskalenko/NitromelonDB/blob/master/LICENSE) for more info.
