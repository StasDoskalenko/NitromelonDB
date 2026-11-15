---
title: Intro
hide_title: true
description: "Overview of syncing NitromelonDB with your own backend, and where to start."
---

# Synchronization

:::tip With a coding agent
The [`nitromelondb-sync`](../AgentSkills.md) agent skill builds both sides from these pages: the backend's pull and push endpoints (starting from the [reference server](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/sync-server)), and the app's sync engine around `synchronize()` (one sync at a time, retry, triggers, logout), with tests of two devices converging. `npx skills add StasDoskalenko/NitromelonDB --skill nitromelondb-sync`, then ask your agent to add sync.
:::

WatermelonDB has been designed from scratch to be able to seamlessly synchronize with a remote database (and, therefore, keep multiple copies of data synced with each other).

Note that Watermelon is only a local database — you need to **bring your own backend**. What Watermelon provides are:

- **Synchronization primitives** — information about which records were created, updated, or deleted locally since the last sync — and which columns exactly were modified. You can build your own custom sync engine using those primitives
- **Built-in sync adapter** — You can use the sync engine Watermelon provides out of the box, and you only need to provide two API endpoints on your backend that conform to Watermelon sync protocol

To implement synchronization between your client side database (WatermelonDB) and your server, you need to implement synchronization in the [frontend](../Sync/Frontend.md) & the [backend](../Sync/Backend.md).

The repository has a complete [example sync server](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/sync-server) that follows every rule in the backend docs, including [paginated pulls](../Sync/Frontend.md#paginated-pulls) for large syncs.
