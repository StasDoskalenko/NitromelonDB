---
description: "Fixes for sync problems: a release build failure (UglifyES), interrupted paginated pulls, and the paginated pull warnings."
---


**⚠️ Note about a React Native / UglifyES bug**. When you import Watermelon Sync, your app might fail to compile in release mode. To fix this, configure Metro bundler to use Terser instead of UglifyES. Run:

```bash
yarn add metro-minify-terser
```

Then, update `metro.config.js`:

```js
module.exports = {
    // ...
    transformer: {
        // ...
        minifierPath: 'metro-minify-terser',
    },
}
```

You might also need to switch to Terser in Webpack if you use Watermelon for web.

### Every sync fails after an interrupted paginated pull

A sync that stopped halfway through a [paginated pull](./Frontend.md#paginated-pulls) continues from the saved cursor next time. If the server rejects that cursor (it expired, or the server changed how it pages), every sync fails the same way. The server should answer an unusable cursor with the first page instead, as if there were no cursor ([Backend: paginated pulls](./Backend.md#paginated-pulls), rule 5). Pages the app already applied come again, which is harmless.

### Development builds warn about `experimentalHasMore`

Your server or `pullChanges()` returns `experimentalHasMore`, from a WatermelonDB pull request that was never released. NitromelonDB pulls only that page (the rest comes with the next sync). Return `nextCursor` instead: see [paginated pulls](./Frontend.md#paginated-pulls).

### Development builds warn that `paginatedPulls` is not enabled

`pullChanges()` returned a `nextCursor`, but `synchronize()` wasn't called with `paginatedPulls: true`, so only the first page was applied. If your server pages pulls, pass `paginatedPulls: true` (see [paginated pulls](./Frontend.md#paginated-pulls)). If it didn't mean to, make it page only for apps that ask ([Backend: paginated pulls](./Backend.md#paginated-pulls), rule 0).
