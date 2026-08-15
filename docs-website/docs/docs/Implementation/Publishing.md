# Publishing NitromelonDB

Releases are done with GitHub Actions. Do not publish to npm from your laptop.

Full details: [`.github/workflows/README.md`](https://github.com/StasDoskalenko/NitromelonDB/blob/master/.github/workflows/README.md).

### Step 1: Keep `CHANGELOG-Unreleased.md` current

Every merged change should already have a note there. Prepare Release copies those notes into `CHANGELOG.md` automatically.

### Step 2: Prepare the release

1. GitHub → **Actions** → **Prepare Release**
2. Run the workflow from **master**
3. Choose:
   - **Version bump:** `none` / `patch` / `minor` / `major` (`none` keeps the current X.Y.Z)
   - **Prerelease:** `none` / `alpha` / `beta`

To ship another alpha of the same version: bump **`none`** + prerelease **`alpha`** (`0.30.0-alpha.0` → `0.30.0-alpha.1`). Choosing prerelease `none` on an in-progress alpha/beta publishes that version as stable.

### Step 3: Review and merge the PR

The workflow opens a `release/v…` PR with the version bump and changelog. CI runs on that PR. Merge when it looks right.

### Step 4: Automatic publish

Merging the PR:

- Builds `dist/`
- Publishes `nitromelondb` to npm (`latest`, `alpha`, or `beta`)
- Creates the git tag and GitHub Release

### Local helpers

```bash
# Preview the next version without changing files
node scripts/next-version.mjs minor alpha

# Version calculator tests
node scripts/next-version.mjs --self-test
```

The interactive `yarn release` script is legacy. Use Actions instead.

### npm authentication

No `NPM_TOKEN` secret. Releases authenticate with [npm trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/).

One-time: if `nitromelondb` is not on npm yet, publish once from your machine (`yarn build && npm publish ./dist --otp=…`), then on [package access settings](https://www.npmjs.com/package/nitromelondb/access) add a GitHub Actions trusted publisher:

- Organization or user: `StasDoskalenko`
- Repository: `NitromelonDB`
- Workflow filename: `publish-release.yml` (filename only)
- Environment: leave empty
- Allowed actions: `npm publish`

After the first Actions publish works, set **Require two-factor authentication and disallow tokens** on that same page. Details: [`.github/workflows/README.md`](https://github.com/StasDoskalenko/NitromelonDB/blob/master/.github/workflows/README.md).
