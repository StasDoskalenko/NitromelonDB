### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- The deprecated `@action` decorator no longer throws `Cannot read properties of undefined (reading 'table')` when it decorates a method of a `Collection` subclass. It now gets the table name when the method runs, like `@writer` and `@reader` ([#84](https://github.com/StasDoskalenko/NitromelonDB/issues/84)). Its deprecation warning now names `@action` ("Use @writer instead") instead of `Database.action()`, which `@action` users never call directly. Still once per app run and only in development.
- Android: release builds with R8 (`minifyEnabled`, which Expo SDK 58 now turns on by default) no longer abort on the first database open with `ClassNotFoundException: com.nitromelondb.NativeDatabasePath`. The library now ships consumer ProGuard rules that keep the classes and methods its C++ code finds by name over JNI.

### Performance

### Changes

- Docs: new [Custom Collections](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs-website/docs/docs/Advanced/CustomCollections.md) page covering `static associatedCollectionClass`, which lets a Model use its own `Collection` subclass for table-level `@writer` / `@reader` methods and named queries.

### Internal
