# Release Workflows

Automated releases for `nitromelondb`, modeled on the two-step process used in [react-native-google-fit](https://github.com/StasDoskalenko/react-native-google-fit).

## Workflows

### 1. `prepare-release.yml` — Prepare Release

**Trigger:** Manual (`workflow_dispatch`)

**Inputs:**

| Field | Options | Purpose |
| --- | --- | --- |
| Version bump | `patch`, `minor`, `major` | Semver bump from the current `package.json` version |
| Prerelease | `none`, `alpha`, `beta` | Optional prerelease channel |

**What it does:**

1. Calculates the next version (see [Versioning](#versioning))
2. Creates a `release/vX.Y.Z` branch (or `release/vX.Y.Z-alpha.N` / `-beta.N`)
3. Bumps `package.json`
4. Moves `CHANGELOG-Unreleased.md` into `CHANGELOG.md` under the new version heading
5. Resets `CHANGELOG-Unreleased.md` to empty section headers
6. Syncs `docs-website/docs/docs/CHANGELOG.md`
7. Opens a PR to `master` for review

Run it from **master**: Actions → **Prepare Release** → Run workflow.

### 2. `publish-release.yml` — Publish Release

**Trigger:** Automatic when a `release/v*` PR is merged to `master`

**What it does:**

1. Builds the package (`yarn build` → `dist/`)
2. Publishes `nitromelondb` to npm (`latest`, `alpha`, or `beta` dist-tag)
3. Creates git tag `vX.Y.Z`
4. Creates a GitHub Release (marked as prerelease for alpha/beta)
5. Comments on the PR with npm and GitHub links

## Release process

```mermaid
flowchart TD
    Start([Start Release]) --> Manual1[/"👤 Step 1: Prepare Release<br/>(Actions → Prepare Release)"/]

    Manual1 --> Action1["🔧 prepare-release.yml<br/>• Bump version<br/>• Roll CHANGELOG-Unreleased.md<br/>• Open release/vX.Y.Z PR"]

    Action1 --> Manual2[/"👤 Step 2: Review and merge PR"/]

    Manual2 --> Auto1["⚡ publish-release.yml<br/>• yarn build<br/>• npm publish ./dist<br/>• Tag + GitHub Release"]

    Auto1 --> Done([✨ Release complete])
```

## Versioning

`package.json` is currently `0.28.1-0` (an unpublished prerelease of 0.28.1). Typical first releases:

| Current | Bump | Prerelease | Result |
| --- | --- | --- | --- |
| `0.28.1-0` | minor | alpha | `0.29.0-alpha.0` |
| `0.28.1-0` | major | alpha | `1.0.0-alpha.0` |
| `0.28.1-0` | minor | none | `0.29.0` |
| `0.28.1-0` | patch | none | `0.28.1` |

After that, repeating the same bump + channel increments the prerelease counter:

| Current | Bump | Prerelease | Result |
| --- | --- | --- | --- |
| `0.29.0-alpha.0` | minor | alpha | `0.29.0-alpha.1` |
| `0.29.0-alpha.1` | minor | beta | `0.29.0-beta.0` |
| `0.29.0-beta.0` | minor | none | `0.29.0` |
| `1.0.0-alpha.0` | major | alpha | `1.0.0-alpha.1` |
| `1.0.0-alpha.2` | major | none | `1.0.0` |
| `0.28.1` | patch | none | `0.28.2` |

Repeating the **same** bump + channel increments `-alpha.N` / `-beta.N`. Choosing `none` on an in-progress prerelease publishes that core version as stable. A *different* bump starts a new core version (`0.29.0-alpha.0` + major + alpha → `1.0.0-alpha.0`).

npm dist-tags:

- stable → `latest`
- `-alpha.N` → `alpha`
- `-beta.N` → `beta`

```bash
npm install nitromelondb@latest
npm install nitromelondb@alpha
npm install nitromelondb@beta
```

Local check:

```bash
node scripts/next-version.mjs --self-test
node scripts/next-version.mjs minor alpha
```

## Unreleased changelog

Contributors add notes to `CHANGELOG-Unreleased.md`. Prepare Release copies non-empty sections into `CHANGELOG.md` as:

```md
## 0.29.0-alpha.0 - 2026-08-15

### New features
- ...
```

Empty section headers are dropped. The unreleased file is then reset for the next cycle.

## npm trusted publishing (OIDC)

Publishing does **not** use `NPM_TOKEN`. GitHub Actions authenticates to npm with a short-lived OIDC token ([trusted publishing](https://docs.npmjs.com/trusted-publishers/)).

### One-time setup on npmjs.com

`nitromelondb` must exist on npm before you can attach a trusted publisher. If it is not published yet, do **one** local bootstrap (2FA / OTP is fine here):

```bash
yarn build
npm publish ./dist --access public --otp=123456
```

Then:

1. Open [nitromelondb access settings](https://www.npmjs.com/package/nitromelondb/access)
2. Under **Trusted Publisher**, choose **GitHub Actions**
3. Fill in exactly:

   | Field | Value |
   | --- | --- |
   | Organization or user | `StasDoskalenko` |
   | Repository | `NitromelonDB` |
   | Workflow filename | `publish-release.yml` |
   | Environment name | *(leave empty)* |
   | Allowed actions | `npm publish` |

4. After the first Actions publish succeeds: Settings → **Publishing access** → **Require two-factor authentication and disallow tokens**. That blocks classic tokens; OIDC keeps working.

Do not add an `NPM_TOKEN` secret to this repository.

## Troubleshooting

### Prepare Release refused to run
- Select branch **master** when starting the workflow

### PR not created
- Check the Prepare Release run logs
- Confirm `release/v…` does not already exist

### npm publish did not run
- PR must come from `release/vX.Y.Z` (or `-alpha.N` / `-beta.N`) in this repository
- PR must be merged, not only closed

### npm publish failed
- Confirm the trusted publisher on npmjs.com matches `StasDoskalenko` / `NitromelonDB` / `publish-release.yml`
- Confirm the workflow has `id-token: write` (it does in `publish-release.yml`)
- Confirm that version is not already on npm
- Review the Publish Release logs
- `ENEEDAUTH` almost always means the workflow filename or repo name does not match the trusted publisher config (case-sensitive, include `.yml`)
