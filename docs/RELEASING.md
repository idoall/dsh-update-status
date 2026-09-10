# Releasing dsh-update-status

Releases are built from immutable Git tags and published by GitHub Actions through npm Trusted Publishing (GitHub OIDC). The repository deliberately stores **no** `NPM_TOKEN`, npm access token, or OTP.

## One-time npm configuration

Before pushing the first release tag, create or configure the `dsh-update-status` package at [npmjs.com](https://www.npmjs.com/), then add a **Trusted Publisher**:

| npm field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Owner | `idoall` |
| Repository | `dsh-update-status` |
| Workflow filename | `release.yml` |
| Environment | Leave blank |

The workflow path must be `.github/workflows/release.yml`. Do **not** add an `NPM_TOKEN` GitHub secret: the `publish` job receives only a short-lived GitHub OIDC token through `id-token: write`.

For a first public package, npm may require the package to be created/claimed through its UI before a Trusted Publisher can be attached. Complete that npm-side step under the publishing account before pushing the tag.

## What a release tag does

Pushing a tag matching `v*` triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Require `vX.Y.Z` to exactly match `package.json`’s `X.Y.Z` version.
2. Install dependencies with a frozen lockfile, run tests, build, and pack exactly one `.tgz` artifact.
3. Upload that artifact and `SHA256SUMS` as a GitHub Actions artifact.
4. Publish that same artifact to npm with Trusted Publishing and the `latest` dist-tag.
5. Create (or update) the GitHub Release and attach the tarball and checksum **only after** the publish job succeeds.

If `dsh-update-status@X.Y.Z` already exists on npm, the immutable npm package is left unchanged and the workflow continues safely to the GitHub Release step.

## Before every release

Never release an uncommitted worktree or reuse a published npm version.

```sh
git switch main
git pull --ff-only
git status --short
pnpm install --frozen-lockfile
pnpm run verify
node -p "require('./package.json').version"
```

`git status --short` must be empty, and the printed version must be the intended unpublished version.

For an extra local artifact check:

```sh
rm -rf .tmp/release && mkdir -p .tmp/release
pnpm pack --pack-destination .tmp/release
shasum -a 256 .tmp/release/dsh-update-status-*.tgz
npm pack --dry-run .tmp/release/dsh-update-status-*.tgz
```

Before the first release, verify npm does not already own the exact version:

```sh
VERSION="$(node -p "require('./package.json').version")"
npm view "dsh-update-status@$VERSION" version || true
```

## Publish a version

After npm Trusted Publishing is configured and the matching source commit is on `main`:

```sh
VERSION="$(node -p "require('./package.json').version")"
git tag -a "v$VERSION" -m "dsh-update-status v$VERSION"
git push origin "v$VERSION"
```

Watch the **Release** workflow in GitHub Actions. It publishes npm and creates the GitHub Release; do not run `npm publish` locally for a tag-managed release.

## Verify the public package

After the workflow succeeds:

```sh
VERSION="$(node -p "require('./package.json').version")"
npm view "dsh-update-status@$VERSION" name version dist-tags repository --json
npm view dsh-update-status dist-tags --json

VERIFY_DIR="$(mktemp -d)"
cd "$VERIFY_DIR"
npm pack "dsh-update-status@$VERSION"
npm install --ignore-scripts "./dsh-update-status-$VERSION.tgz"
node -e "const p=require('./node_modules/dsh-update-status/package.json'); console.log(p.name,p.version,p.dsh?.client?.platform)"
```

The final command must print:

```text
dsh-update-status X.Y.Z web
```

Then install the package in a disposable DSH profile and manually verify the sidebar badge, panel, release-channel selection, cache-duration setting, and mobile drawer behavior:

```sh
TEST_HOME="$(mktemp -d)"
DSH_HOME="$TEST_HOME" dsh plugin --profile web add "dsh-update-status@$VERSION"
DSH_HOME="$TEST_HOME" dsh web
```

Stop the disposable DSH Web process after verification. The plugin remains advisory: it does not install, restart, roll back, download, or replace DSH files.

## Candidate builds without publication

Use **Actions → Build release candidate → Run workflow** to make a downloadable package and checksum without publishing npm or creating a GitHub Release. This is useful for pre-tag DSH UI verification.
