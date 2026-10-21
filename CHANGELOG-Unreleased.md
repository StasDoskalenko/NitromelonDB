### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- The deprecated `@action` decorator no longer throws `Cannot read property 'table' of undefined` when the class is defined, if it decorates a method of a `Collection` subclass. It now gets the table name when the method is called, like `@writer` and `@reader` already do ([#84](https://github.com/StasDoskalenko/NitromelonDB/issues/84)). `@action` on a class that isn't a Model or Collection now labels its work `ClassName.method` instead of `undefined.method`.
- Docs: new [Custom Collections](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs-website/docs/docs/Advanced/CustomCollections.md) page covering `static associatedCollectionClass`, which lets a Model use its own `Collection` subclass for table-level `@writer` / `@reader` methods and named queries.

### Performance

### Changes

### Internal
