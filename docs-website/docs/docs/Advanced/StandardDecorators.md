---
description: "Use NitromelonDB models with standard (TC39 2023-11) decorators and the accessor keyword, and migrate from legacy decorators one model at a time."
---

# Standard decorators

JavaScript has two versions of decorators:

- **Legacy decorators**, which TypeScript calls `experimentalDecorators` and Babel calls `legacy: true`. WatermelonDB used them, and they're what the rest of these docs show. They keep working, and they're still the default.
- **Standard decorators**, the TC39 proposal that's becoming part of JavaScript (Babel's `version: '2023-11'`). TypeScript 5+ uses them when `experimentalDecorators` is off.

Every NitromelonDB decorator accepts both. You can switch whenever you like, and models you haven't changed yet keep working.

## Turn them on

**Expo:** pass the version to the preset:

```js
// babel.config.js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { decorators: { version: '2023-11' } }]],
  }
}
```

**Bare React Native:** replace the four legacy plugins from [Installation](../Installation.mdx) with these two:

```js
// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
    '@babel/plugin-transform-class-static-block',
  ],
}
```

**TypeScript:** remove `experimentalDecorators` (and `emitDecoratorMetadata`) from `tsconfig.json`. TypeScript 5.0 or newer is required.

The mode applies to the whole app at once: Babel compiles every file with one decorators version, and the legacy plugin can't parse the `accessor` keyword.

## Update your models

With standard decorators, a decorator can't turn a plain class field into a getter and setter, which is how model fields read and write the database. The `accessor` keyword gives it one:

```ts
class Post extends Model {
  static table = 'posts'

  // legacy decorators
  @text('title') title!: string

  // standard decorators
  @text('title') accessor title!: string
}
```

| Decorator | With standard decorators |
| --- | --- |
| `@field`, `@text`, `@date`, `@json` | `@field('name') accessor name` |
| `@relation`, `@immutableRelation`, `@children` | `@relation('blogs', 'blog_id') accessor blog` |
| `@nochange`, `@readonly` | Put them before the field decorator, as before: `@readonly @date('created_at') accessor createdAt` |
| `@writer`, `@reader`, `@action` | Unchanged: `@writer async rename(name) { ... }` |
| `@lazy` | Use a getter: `@lazy get recentComments() { return this.comments.extend(...) }` |
| `@experimentalFailsafe` | Legacy decorators only, for now |

Values still live in the record's raw data, so change tracking, sync and observation work the same.

### Migrating one model at a time

Models without `accessor` keep working with standard decorators. Plain fields get their getter and setter on each record when the record is created, instead of once on the class. That's slower: in a Node benchmark it added about 2 µs per record with five fields (about 100 ms for 50,000 records). In development, NitromelonDB logs a warning once per field, naming the field that needs `accessor`.

So you can switch the Babel config first, then add `accessor` to models as you go, starting with the tables you load the most records from.

### `@lazy`

Standard decorators run a field's initializer while the record is being built, before the decorator could defer it. So `@lazy` on a field computes the value when the record is created (still only once), and logs a warning in development. To compute it on first read, use a getter:

```js
class Post extends Model {
  @children('comments') accessor comments

  @lazy get verifiedComments() {
    return this.comments.extend(Q.where('is_verified', true))
  }
}
```

The getter form works with legacy decorators too.

## Things that behave differently

- **Enumerating fields:** an `accessor` field is a non-enumerable property of the class, so it doesn't appear in a `for...in` loop over a record, while legacy fields do. `Object.keys(record)` and `JSON.stringify(record)` don't include fields in either mode.
- **Default values:** model fields can't have a default value in either mode. With standard decorators the error comes when a record is created, not when the class is defined.
- **`@readonly` on a method** is a legacy-only feature.
