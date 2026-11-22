---
description: "How NitromelonDB releases are prepared and published to npm through GitHub Actions."
---

# Publishing NitromelonDB

Releases are done with GitHub Actions. Do not publish to npm from your laptop.

Full details: [`.github/workflows/README.md`](https://github.com/StasDoskalenko/NitromelonDB/blob/master/.github/workflows/README.md).

### Step 1: Keep `CHANGELOG-Unreleased.md` current

Every merged change should already have a note there. Prepare Release copies those notes into `CHANGELOG.md` automatically. Graduating an alpha/beta to stable also folds that version's prerelease changelog sections into one official entry.

### Step 2: Prepare the release

1. GitHub → **Actions** → **Prepare Release**
2. Run the workflow from **master** (or from a release line, below)
3. Choose:
   - **Version bump:** `none` / `promote` / `patch` / `minor` / `major` (`none` keeps the current X.Y.Z; `promote` ships the in-progress alpha/beta as official `X.Y.Z`)
   - **Prerelease:** `none` / `alpha` / `beta` (ignored when bump is `promote`)
   - **npm dist-tag:** `none` / `latest` / `alpha` / `beta` (`none` is default behavior: alpha→`alpha`, beta→`beta`, official→`latest`)

To ship another alpha of the same version: bump **`none`** + prerelease **`alpha`** (`0.30.0-alpha.0` → `0.30.0-alpha.1`). To graduate that line: bump **`promote`**. Choosing prerelease `none` on an in-progress alpha/beta also publishes that version as stable.

Leave **npm dist-tag** on `none` unless this version should become what `npm i nitromelondb` installs. Do not put every beta on `latest` after a stable exists.

### Step 3: Review and merge the PR

The workflow opens a `release/v…` PR with the version bump and changelog. CI runs on that PR. Merge when it looks right.

### Step 4: Automatic publish

Merging the PR pushes the release commit to `master`, which runs Publish Release:

- Builds `dist/`
- Publishes `nitromelondb` to npm (`latest`, `alpha`, or `beta`, unless Prepare recorded an override)
- Creates the git tag and GitHub Release

If npm publish fails, do not run Prepare Release again. Run **Actions → Publish Release** from **master** to retry the same version.

### Releasing an older version without master's newer work

A **release line** (`release/X.Y.x` branch) ships `X.Y.*` versions without what master has had since: an alpha promoted as it was tested, or a patch with only the fixes picked for it.

1. **Actions** → **Cut Release Line**, from **master**, with the tag to start from (e.g. `v0.32.1-alpha.0` creates `release/0.32.x`). Once per `X.Y`.
2. Fixes go to the line as pull requests (cherry-picked from master), each with a `CHANGELOG-Unreleased.md` entry.
3. **Actions** → **Prepare Release**, run from **`release/0.32.x`**: `promote` ships the alpha as `0.32.1`, `patch` ships a hotfix (`0.32.2`). The release PR goes to the line.
4. Merging it publishes from the line, then opens a PR that records the release in master's `CHANGELOG.md` (and moves master's version up if it's behind). Merge that too.

Master then releases with `minor` / `major`. A line's release takes npm's `latest` only if it's the newest version; otherwise it gets `latest-X.Y`. Details: [Release lines](https://github.com/StasDoskalenko/NitromelonDB/blob/master/.github/workflows/README.md#release-lines).

### Local helpers

```bash
# Preview the next version without changing files
node scripts/next-version.mjs minor alpha

# Version calculator and changelog-fold tests
node scripts/next-version.mjs --self-test
node scripts/prepare-changelog.mjs --self-test
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
