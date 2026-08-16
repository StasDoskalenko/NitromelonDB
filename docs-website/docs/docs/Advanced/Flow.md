---
title: Flow
hide_title: true
---

# Flow support removed

WatermelonDB's JavaScript source is TypeScript. Flow types, `.flowconfig`, `flow-bin`, and `@nozbe/watermelondb/types` are no longer shipped.

Use [TypeScript](https://www.typescriptlang.org/) instead. See the [TypeScript example](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/typescript) for model, schema, and query typing.

| Flow | TypeScript |
| --- | --- |
| `RecordId` | `import type { RecordId } from 'nitromelondb'` |
| `TableName<T>`, `ColumnName` | `import type { TableName, ColumnName } from 'nitromelondb'` |
| `$Call<…>` relation id extractors | `import type { RelationId } from 'nitromelondb'` |
| `$Diff`, `$Rest`, `$Shape` | `Omit`, `Partial`, `Pick` |

If you are switching from `@nozbe/watermelondb`, see [Migrating from WatermelonDB](../Migrating.md).
