---
title: Agent skills
hide_title: true
description: "Skills for AI coding agents (Claude Code, Cursor, Codex and others): install NitromelonDB in an app, design and change its schema, build sync, migrate from WatermelonDB, move to standard decorators, audit an app's setup, and find missing indexes."
---

# Agent skills

NitromelonDB ships skills for AI coding agents: step-by-step procedures an agent follows in your app's repository. They work with Claude Code, Cursor, Codex and other agents that support the [Agent Skills](https://agentskills.io) format.

Every skill builds on what NitromelonDB adds over WatermelonDB (hooks, batched writers, nested-writer detection, integer storage, paginated sync) and follows [Building a fast app](./Advanced/Performance.md#building-a-fast-app).

## Start here

| Skill | What it does | Changes your code? |
| --- | --- | --- |
| [`nitromelondb-install`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-install) | Adds NitromelonDB to an app that doesn't use it yet: checks the requirements, installs the packages, sets up decorators, TypeScript and the Expo plugin for the platform (Expo, Expo web, bare React Native, Vite, Webpack, Node, Electron, Windows), creates the schema, migrations, models and `Database` with the recommended options, wires up `DatabaseProvider`, adds a data layer on observing hooks and batched writers, and checks the build and a first write and read. Follows [Installation](./Installation.mdx) and [Setup](./Setup.md). | Yes |
| [`nitromelondb-migrate-from-watermelondb`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-migrate-from-watermelondb) | Moves an app from `@nozbe/watermelondb` to `nitromelondb`: packages, imports, Jest mocks, patches, old native linking and config plugins, adapter options, Babel decorators setup. Then proposes what NitromelonDB adds, with `file:line`, and applies what you pick. Follows [Migrating from WatermelonDB](./Migrating.md). | Yes |

## Building the app

| Skill | What it does | Changes your code? |
| --- | --- | --- |
| [`nitromelondb-schema`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-schema) | Designs the schema from your app's own types, API responses and stored state: tables, columns, one-to-many and many-to-many relations, JSON fields, indexes, what to keep out of the database, and what sync needs. Writes the schema, migrations and typed models. For an app that has shipped, makes every change as a migration with a version bump, and tests an upgrade and a fresh install. Follows [Schema](./Schema.md) and [Migrations](./Advanced/Migrations.md). | After you agree to the proposal |
| [`nitromelondb-sync`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-sync) | Builds sync on both sides. The backend: pull and push endpoints with change tracking, a monotonic clock, consistent pulls, transactional pushes with conflict detection, paginated pulls, migration syncs and per-user scoping, starting from the [reference server](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/sync-server). The app: a sync engine around `synchronize()` (one sync at a time, retry, triggers on launch, foreground and local changes, logout). Tests two devices converging. Follows [Sync](./Sync/Intro.md). | Yes |
| [`nitromelondb-migrate-decorators`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-migrate-decorators) | Moves models from legacy decorators to [standard decorators](./Advanced/StandardDecorators.md): Babel config, `tsconfig`, `accessor` on fields, `@lazy` getters. Stops first if another library still needs legacy decorators. | Yes |

## Checking the app

| Skill | What it does | Changes your code? |
| --- | --- | --- |
| [`nitromelondb-audit`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-audit) | Reviews how the app uses NitromelonDB and reports problems by severity, with `file:line`: nested writers that deadlock, slow work inside writers, unbatched writes, missing migrations, startup work that races database readiness, models that drifted from the schema, fetching where the UI should observe, unsafe raw SQL, sync mistakes (including deletes that never sync). | Only what you pick from the report |
| [`nitromelondb-indexes`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-indexes) | Lists every query, observer and relation, finds columns that should be indexed (and indexes nothing uses), checks them with `EXPLAIN QUERY PLAN` when it can reach a database file, and writes the schema change with its migration. | Only after you approve the list |

## Install

From the root of your app, with the [`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
# pick from a list
npx skills add StasDoskalenko/NitromelonDB

# or one skill
npx skills add StasDoskalenko/NitromelonDB --skill nitromelondb-install
```

It copies the skill into your project, in the folder your agent reads (`.claude/skills`, `.agents/skills` and so on). Commit it if you want your team to have it, or delete the folder when you're done. The skills hand over to each other (install calls schema, schema points to indexes and sync), so adding them all is the simplest.

## Use

Ask for the task in your own words. The agent picks the skill from its description:

- "Add NitromelonDB to this app, with tables for projects and tasks."
- "Design the database schema for this app." / "Add a tags table to our schema."
- "Add sync with our backend."
- "Migrate this app from WatermelonDB to NitromelonDB."
- "Move our models to standard decorators."
- "Audit how we use NitromelonDB."
- "Find missing database indexes and add them."

In agents with slash commands, the skill's name works too: `/nitromelondb-install`.

Without the CLI, point your agent at a skill's file and ask it to follow it:

```text
Follow https://raw.githubusercontent.com/StasDoskalenko/NitromelonDB/master/skills/nitromelondb-install/SKILL.md
for this app.
```

## What to expect

- **The install, the sync and the migrations edit files.** Start from a clean working copy (everything committed), so the diff is only theirs, and review it. The migrations don't touch your data: SQLite files, the schema and migrations stay as they are. The native build is left to you unless you ask the agent to run it.
- **The schema skill proposes before it writes.** It asks about what it can't tell from the code (how large lists get, which ids the backend uses).
- **The audit and the index review report first.** They change nothing until you say which findings to act on. Adding an index, like any schema change on a shipped app, is a migration, so test it like one: an upgrade from the previous build, and a fresh install. See [Migrations](./Advanced/Migrations.md#step-4-test-your-migrations).
- **They read your code, not your users' data.** The index review can read a database file from your own simulator or emulator to count rows and check query plans. It works on a copy.
- A skill is instructions, not a program. Your agent may still get something wrong, so read the report and the diff.

## For everything else

Skills cover specific jobs. For general questions, point your agent at the docs: [llms.txt](https://stasdoskalenko.github.io/NitromelonDB/llms.txt) is an index of every page as Markdown, and [llms-full.txt](https://stasdoskalenko.github.io/NitromelonDB/llms-full.txt) is all of it in one file.

Missing a skill, or found a check the audit should make? [Open an issue](https://github.com/StasDoskalenko/NitromelonDB/issues).
