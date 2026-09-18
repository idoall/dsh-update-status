# Releasing dsh-update-status

Releases are built from immutable Git tags and published by GitHub Actions through npm Trusted Publishing (GitHub OIDC). The repository stores **no** `NPM_TOKEN`, npm access token, or OTP. npm packages are immutable: never reuse a version that npm has accepted.

## npm Trusted Publisher

The public package at [npmjs.com/package/dsh-update-status](https://www.npmjs.com/package/dsh-update-status) is bound to this repository:

| npm field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Owner | `idoall` |
| Repository | `dsh-update-status` |
| Workflow filename | `release.yml` |
| Environment | Leave blank |

The workflow path must remain `.github/workflows/release.yml`. The `publish` job receives only a short-lived GitHub OIDC token through `id-token: write`. Do not add an `NPM_TOKEN` GitHub secret.

The first `0.1.0` package was bootstrapped once with a token because npm cannot attach a Trusted Publisher until the package exists. Later versions must use OIDC only.

## What a release tag does

Pushing a tag matching `v*` triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Require `vX.Y.Z` to exactly match `package.json`’s `X.Y.Z` version **and** require `docs/releases/vX.Y.Z.md` to exist with both a Chinese and an English section anchor.
2. Install dependencies with a frozen lockfile, run tests, build, and pack exactly one `.tgz` artifact.
3. Upload that artifact and `SHA256SUMS` as a GitHub Actions artifact.
4. Publish that same artifact to npm with Trusted Publishing and the `latest` dist-tag.
5. Create (or update) the GitHub Release with that notes file as its body and attach the tarball and checksum **only after** the publish job succeeds.

If `dsh-update-status@X.Y.Z` already exists on npm, the immutable npm package is left unchanged and the workflow continues safely to the GitHub Release step.

## Release notes are hand-written and bilingual

Every release has exactly one file: `docs/releases/vX.Y.Z.md`. The GitHub Release body **is** that file — the workflow passes it with `--notes-file` and never uses `--generate-notes`, because commit titles do not tell a user what changed for them, what it breaks, or what they must do.

Write it in the layout the DeepSeek Harness release pages use, for example [dsh-v0.1.6-alpha.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1):

```markdown
[中文](#cn-v0.1.3) | [English](#en-v0.1.3)

<h3 id="cn-v0.1.3">插件 0.1.3 — 已验证 DeepSeek Harness 0.1.6-alpha.1</h3>

### 版本对应        <!-- plugin version ↔ verified DSH version ↔ npm status -->
### 问题修复        <!-- what was broken, for whom, and what changed -->
### 改进            <!-- behaviour and test improvements -->
### 兼容性与升级    <!-- verified DSH releases, exact upgrade command, limits -->

<h3 id="en-v0.1.3">Plugin 0.1.3 — verified against DeepSeek Harness 0.1.6-alpha.1</h3>

### Version matrix
### Bug Fixes
### Improvements
### Compatibility and upgrade
```

Rules:

- The two `<h3 id="cn-…">` / `<h3 id="en-…">` anchors are mandatory and must match the tag: the gate greps for `<h3 id="cn-vX.Y.Z">` and `<h3 id="en-vX.Y.Z">`.
- Chinese section first, English section second; both must carry the same facts — not a summary of the other language.
- Lead with the version matrix: which plugin version was verified against which DeepSeek Harness release, and which of them are actually on npm.
- Write every entry as *what changed → who is affected → what the user must do*. State the verified DSH release, the exact upgrade command, and any remaining limitation explicitly.
- A never-published version has no release page of its own. When a published version carries an unpublished one's fix, document both in the shipped release's notes (see `v0.1.3`, which covers the unpublished `0.1.2`).
- Keep the same facts in `CHANGELOG.md`; the release notes may be longer and user-facing, but they must not contradict it.

## Before every release

Never release an uncommitted worktree or reuse a published npm version.

1. Write `docs/releases/vX.Y.Z.md` (bilingual, hand-written — see above) **and** the matching `CHANGELOG.md` entry in the same commit.
2. Update the version matrix in `README.md` and `README.zh.md`: the verified DeepSeek Harness release(s), the npm status of every version, and which version a user on which DSH release should install.
3. Bump `package.json` and `dsh.compatibility.dshReleases` together with `VERIFIED_DSH_VERSIONS` in `src/shared/types.ts`.
4. Verify:

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

Confirm npm does not already own the exact version:

```sh
VERSION="$(node -p "require('./package.json').version")"
npm view "dsh-update-status@$VERSION" version || true
```

## Publish a version

After the matching source commit is on `main`:

```sh
VERSION="$(node -p "require('./package.json').version")"
git tag -a "v$VERSION" -m "dsh-update-status v$VERSION"
git push origin "v$VERSION"
```

Watch the **Release** workflow in GitHub Actions. It publishes npm and creates the GitHub Release; do not run `npm publish` locally for a tag-managed release. Never reuse `0.1.0`.

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

Then install the package in a disposable DSH profile and manually verify the sidebar badge, its three dot states (green when up to date, grey pulse while checking, amber halo when a newer release exists — the chip fill itself must not change), the panel, release-channel selection, cache-duration setting, and mobile drawer behavior:

```sh
TEST_HOME="$(mktemp -d)"
DSH_HOME="$TEST_HOME" dsh plugin --profile web add "dsh-update-status@$VERSION"
DSH_HOME="$TEST_HOME" dsh web
```

Stop the disposable DSH Web process after verification. The plugin remains advisory: it does not install, restart, roll back, download, or replace DSH files.

## Candidate builds without publication

Use **Actions → Build release candidate → Run workflow** to make a downloadable package and checksum without publishing npm or creating a GitHub Release. This is useful for pre-tag DSH UI verification.
