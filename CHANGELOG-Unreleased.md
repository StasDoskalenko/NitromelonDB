### Highlights

### BREAKING CHANGES

- Removed `@action`, `Database.action()`, `Model.subAction()`, `WriterInterface.subAction()`, and `Collection.unsafeFetchRecordsWithSQL()` again. WatermelonDB removed them in 0.26, but the TypeScript migration brought them back by mistake, so they've shipped as deprecated since NitromelonDB 0.30.0. Use `@writer` / `@reader`, `database.write()` / `database.read()`, `callWriter()` / `callReader()`, and `collection.query(Q.unsafeSqlQuery(sql)).fetch()` instead. See [Migrating from WatermelonDB](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs-website/docs/docs/Migrating.md).

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal
