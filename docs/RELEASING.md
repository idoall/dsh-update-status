# Releasing dsh-update-status

This document separates the manually verified first release from the future automated release flow. Never publish from an uncommitted working tree, and never reuse an npm version after publishing: npm versions are immutable.

## Release 0.1.0 — manual verification and publication

The first release is intentionally manual. GitHub Actions verifies the source and can build a downloadable candidate tarball, but no workflow has npm publish permission.

### 1. Verify the source checkout

```sh
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run verify
```

Confirm that `package.json` contains the intended version and that the package name is available:

```sh
node -p "require('./package.json').version"
npm view dsh-update-status version || true
```

For `0.1.0`, the first command must print `0.1.0`. Before the first release, `npm view` should return `E404`.

### 2. Build one candidate from GitHub

Open **Actions → Build release candidate → Run workflow** on the `main` branch. Download the `dsh-update-status-<commit>` artifact and verify its checksum:

```sh
shasum -a 256 -c SHA256SUMS
npm pack --dry-run ./dsh-update-status-0.1.0.tgz
```

Alternatively, build the exact same candidate locally:

```sh
rm -rf .tmp/release && mkdir -p .tmp/release
pnpm pack --pack-destination .tmp/release
shasum -a 256 .tmp/release/dsh-update-status-0.1.0.tgz
```

### 3. Install the tarball into a disposable DSH profile

Do not replace a working production installation before verification. Use a disposable DSH home/profile where possible:

```sh
TEST_HOME="$(mktemp -d)"
DSH_HOME="$TEST_HOME" dsh plugin --profile web add "$(pwd)/.tmp/release/dsh-update-status-0.1.0.tgz"
DSH_HOME="$TEST_HOME" dsh web
```

Open the URL printed by that command and verify:

- the official fish remains unchanged;
- expanded sidebar shows `DeepSeek` plus the version badge;
- collapsed rail shows the fallback status action;
- the panel opens above the mobile drawer and is scrollable;
- `next` is hidden when it points to the same release as the running/latest version;
- `alpha` can be selected in the panel and shows an unverified-compatibility warning;
- generated commands end in `@latest`, `@next`, or `@alpha` as appropriate;
- changing a channel does not install anything;
- only **Check for updates** performs a forced refresh;
- console contains no new `dsh-update-status` errors.

Stop the disposable `dsh web` process when verification is complete.

### 4. Authenticate and publish manually

Check identity and account security first:

```sh
npm whoami
npm profile get
```

Inspect the profile output and confirm that two-factor authentication is enabled for package publication.

Publish the verified tarball, not a newly rebuilt directory:

```sh
npm publish .tmp/release/dsh-update-status-0.1.0.tgz --access public --tag latest
```

If npm requires OTP:

```sh
npm publish .tmp/release/dsh-update-status-0.1.0.tgz --access public --tag latest --otp=123456
```

Never place an npm token or OTP in a repository file, command transcript, issue, or GitHub Actions log.

### 5. Verify the public package

```sh
npm view dsh-update-status@0.1.0 name version dist-tags repository --json
npm view dsh-update-status dist-tags --json

VERIFY_DIR="$(mktemp -d)"
cd "$VERIFY_DIR"
npm pack dsh-update-status@0.1.0
npm install --ignore-scripts ./dsh-update-status-0.1.0.tgz
node -e "const p=require('./node_modules/dsh-update-status/package.json'); console.log(p.name,p.version,p.dsh?.client?.platform)"
```

The last command must print `dsh-update-status 0.1.0 web`. Then install from npm in the disposable DSH profile and repeat the GUI checklist:

```sh
DSH_HOME="$TEST_HOME" dsh plugin --profile web remove dsh-update-status || true
DSH_HOME="$TEST_HOME" dsh plugin --profile web add dsh-update-status@0.1.0
DSH_HOME="$TEST_HOME" dsh web
```

Only after public-package verification succeeds, create and push the immutable source tag and GitHub Release:

```sh
cd /path/to/dsh-update-status
git tag -s v0.1.0 -m "dsh-update-status v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --verify-tag --generate-notes --title "v0.1.0"
```

Use `git tag -a` instead of `git tag -s` only if signing is not configured.

## Release 0.1.1 — automated GitHub and npm publication

After the manual `0.1.0` proves package installation and compatibility, add an automated tag workflow in a separate reviewed change. It should follow the `dsh-quick-replies` model:

1. Require `v*` to equal `package.json` version.
2. Install with a frozen lockfile, test, build, and pack exactly once.
3. Upload the tarball and checksum as a GitHub artifact.
4. Publish that artifact with npm Trusted Publishing (GitHub OIDC), not a long-lived `NPM_TOKEN`.
5. Create a GitHub Release only after packaging succeeds.
6. Make the npm step safely exit when the exact version already exists.

Configure npm Trusted Publishing for:

- Owner: `idoall`
- Repository: `dsh-update-status`
- Workflow filename: `release.yml`
- Environment: leave empty unless the workflow explicitly uses one

Do not add `release.yml` until the first release has been manually installed and verified.
