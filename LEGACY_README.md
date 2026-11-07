<p align="center">
  <img src="https://github.com/StasDoskalenko/NitromelonDB/raw/master/assets/logo-horizontal.png" alt="NitromelonDB" width="400" />
</p>

# About WatermelonDB

NitromelonDB continues [WatermelonDB](https://github.com/Nozbe/WatermelonDB), created by [Nozbe](https://github.com/Nozbe) and mainly written by [Radek Pietruszewski](https://github.com/radex). This page keeps the original introduction to the ideas behind it, lightly edited. For NitromelonDB itself, see the [README](https://github.com/StasDoskalenko/NitromelonDB#readme).

## Why Watermelon?

WatermelonDB is a different way to handle user data in React Native and React web apps.

It was built for **complex apps**, and its first goal is **real-world performance**. Put simply: your app has to launch fast.

For a simple app, Redux or MobX with a persistence adapter is the easiest way to go. But once you have thousands or tens of thousands of records, launch gets slow, especially on slower Android phones, because loading a whole database into JavaScript is expensive.

Watermelon fixes that **by being lazy**. Nothing is loaded until something asks for it. And because every query runs directly on [SQLite](https://www.sqlite.org/index.html), on a separate native thread, most queries return almost instantly.

Unlike using SQLite directly, Watermelon is **fully observable**. When you change a record, every part of the UI that depends on it re-renders on its own. Completing a task in a to-do app re-renders the task, the list (to reorder it), and every counter that includes it. [Learn more](https://www.youtube.com/watch?v=UlZ1QnFF4Cw) in the talk below.

| <a href="https://www.youtube.com/watch?v=UlZ1QnFF4Cw"><img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/watermelon-talk-thumbnail.jpg" alt="React Native EU: Next-generation React Databases" width="300" /></a> |
| ---- |
| <p align="center"><a href="https://www.youtube.com/watch?v=UlZ1QnFF4Cw">📺 <strong>Next-generation React databases</strong><br/>(a talk about WatermelonDB)</a></p> |

## The original pitch

|   | WatermelonDB |
| - | ------------ |
| ⚡️ | **Launch your app instantly**, no matter how much data you have |
| 📈 | **Highly scalable**, from hundreds to tens of thousands of records |
| 😎 | **Lazy loaded.** Data is loaded only when you need it |
| 🔄 | **Offline-first.** Sync with your own backend |
| ⚛️ | **Optimized for React.** Easily plug data into components |
| 🧰 | **Framework-agnostic.** Use the JS API with other UI frameworks |
| ✨ | **Reactive.** Optional [RxJS](https://github.com/ReactiveX/rxjs) API |
| 🔗 | **Relational.** Built on [SQLite](https://www.sqlite.org) |
| ✅ | **Proven.** Has powered [Nozbe](https://nozbe.com/teams) since 2017, and the apps below |

## Who uses WatermelonDB

These apps were built on WatermelonDB:

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

Does your app use NitromelonDB or WatermelonDB? Open a pull request and add your logo here.

## Credits

**WatermelonDB** was created by [@Nozbe](https://github.com/Nozbe). Its main author is [Radek Pietruszewski](https://github.com/radex) ([website](https://radex.io) ⋅ [𝕏 (Twitter)](https://twitter.com/radexp)). See the [original contributors](https://github.com/Nozbe/WatermelonDB/graphs/contributors).
