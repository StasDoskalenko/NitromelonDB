---
title: Agent skills
hide_title: true
description: "Skills for AI coding agents (Claude Code, Cursor, Codex and others): migrate from WatermelonDB, move to standard decorators, audit an app's NitromelonDB setup, and find missing indexes."
---

# Agent skills

NitromelonDB ships skills for AI coding agents: step-by-step procedures an agent follows in your app's repository. They work with Claude Code, Cursor, Codex and other agents that support the [Agent Skills](https://agentskills.io) format.

| Skill | What it does | Changes your code? |
| --- | --- | --- |
| [`nitromelondb-migrate-from-watermelondb`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-migrate-from-watermelondb) | Moves an app from `@nozbe/watermelondb` to `nitromelondb`: packages, imports, Jest mocks, old native linking, adapter options, Babel decorators setup. Follows [Migrating from WatermelonDB](./Migrating.md). | Yes |
| [`nitromelondb-migrate-decorators`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-migrate-decorators) | Moves models from legacy decorators to [standard decorators](./Advanced/StandardDecorators.md): Babel config, `tsconfig`, `accessor` on fields, `@lazy` getters. Stops first if another library still needs legacy decorators. | Yes |
| [`nitromelondb-audit`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-audit) | Reviews how the app uses NitromelonDB and reports problems by severity, with `file:line`: nested writers that deadlock, slow work inside writers, unbatched writes, missing migrations, startup work that races database readiness (early listeners, observers and writes), models that drifted from the schema, fetching where the UI should observe, unsafe raw SQL, sync mistakes. | Only what you pick from the report |
| [`nitromelondb-indexes`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/skills/nitromelondb-indexes) | Lists every query, observer and relation, finds columns that should be indexed (and indexes nothing uses), checks them with `EXPLAIN QUERY PLAN` when it can reach a database file, and writes the schema change with its migration. | Only after you approve the list |

## Install

From the root of your app, with the [`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
# pick from a list
npx skills add StasDoskalenko/NitromelonDB

# or one skill
npx skills add StasDoskalenko/NitromelonDB --skill nitromelondb-audit
```

It copies the skill into your project, in the folder your agent reads (`.claude/skills`, `.agents/skills` and so on). Commit it if you want your team to have it, or delete the folder when you're done.

## Use

Ask for the task in your own words. The agent picks the skill from its description:

- "Migrate this app from WatermelonDB to NitromelonDB."
- "Move our models to standard decorators."
- "Audit how we use NitromelonDB."
- "Find missing database indexes and add them."

In agents with slash commands, the skill's name works too: `/nitromelondb-audit`.

Without the CLI, point your agent at a skill's file and ask it to follow it:

```text
Follow https://raw.githubusercontent.com/StasDoskalenko/NitromelonDB/master/skills/nitromelondb-audit/SKILL.md
for this app.
```

## What to expect

- **The two migrations edit files.** Run them on a clean git working tree, so the diff is only theirs, and review it. Neither touches your data: SQLite files, the schema and migrations stay as they are.
- **The audit and the index review report first.** They change nothing until you say which findings to act on. Adding an index is a schema change with a migration, so test it like one: an upgrade from the previous build, and a fresh install. See [Migrations](./Advanced/Migrations.md#step-4-test-your-migrations).
- **They read your code, not your users' data.** The index review can read a database file from your own simulator or emulator to count rows and check query plans. It works on a copy.
- A skill is instructions, not a program. Your agent may still get something wrong, so read the report and the diff.

## For everything else

Skills cover specific jobs. For general questions, point your agent at the docs: [llms.txt](https://stasdoskalenko.github.io/NitromelonDB/llms.txt) is an index of every page as Markdown, and [llms-full.txt](https://stasdoskalenko.github.io/NitromelonDB/llms-full.txt) is all of it in one file.

Missing a skill, or found a check the audit should make? [Open an issue](https://github.com/StasDoskalenko/NitromelonDB/issues).
