<h1 align="center">DSH Update Status</h1>

<p align="center">A read-only version badge and release-channel guide for the DeepSeek Harness Web sidebar.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-update-status"><img src="https://img.shields.io/npm/v/dsh-update-status?label=npm&color=CB3837" alt="npm version"></a>
  <a href="https://github.com/idoall/dsh-update-status/actions/workflows/ci.yml"><img src="https://github.com/idoall/dsh-update-status/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F172A" alt="MIT"></a>
</p>

<p align="center">English | <a href="README.zh.md">中文</a></p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#release-channels">Release channels</a> ·
  <a href="#lan--non-loopback-pages">LAN pages</a> ·
  <a href="#compatibility">Compatibility</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="#security-boundary">Security</a> ·
  <a href="#uninstall">Uninstall</a> ·
  <a href="docs/RELEASING.md">Release guide</a>
</p>

> DSH Update Status is a community plugin for DeepSeek Harness. It does not modify DSH core and it never installs, restarts, rolls back, downloads, or replaces DSH files.

It shadows only the expanded sidebar brand name with `DeepSeek` plus a compact version chip that fits the 24px brand row, leaving the official fish mark untouched. A green dot next to the version means there is nothing to do, and a breathing amber dot means a newer release is available. Tap the chip to inspect npm release channels, compatibility status, and a copy-only command for the selected channel.

<p align="center">
  <img src="./assets/update-panel.png" width="400" alt="DSH Update Status panel: cache duration, the running 0.1.6-alpha.2 on the alpha channel, a latest row that does not match the followed channel, compatibility labels, and a copy-only upgrade command">
</p>

## Features

- **Visible version status** — shows the running DSH version in the expanded sidebar and a fallback action in the collapsed rail.
- **Quiet update signal** — a pending update never repaints the version chip. Only an amber dot with a soft halo next to the version breathes (scale + glow; the animation is disabled under `prefers-reduced-motion`), so a new release reads as one small light instead of a recoloured brand row.
- **Three dot states, one glance** — with nothing to do the dot beside the version is a plain **green circle** (the theme's success colour, not the text colour, so a dark shell no longer paints a dot that reads as "off"). While a check is running it is the neutral grey pulse; a pending update is the amber halo. Only the update state animates or glows, and only a failed status read repaints the chip, in red.
- **Neutral chip surface** — the chip is a grey second-level surface in both themes (`#f1f3f5` light / `#353638` dark) with the theme's normal label colour, so the dark shell gets a dark grey chip with white text rather than a white pill that hides the amber halo.
- **Light, dark, or system — followed automatically** — every colour the plugin renders is a DSH semantic token, so the chip, the dot, its halo, the footer ring and the panel all resolve through whatever appearance DSH is using. Set DSH to light, to dark, or to system and the plugin switches with the shell: no plugin-side theme setting, no media query to keep in sync. Hover lifts the chip in both directions (darkened in light mode, lightened in dark mode) by mixing the theme's label colour into the surface.
- **Stable and preview discovery** — reads npm dist-tags `latest`, `next`, and `alpha` in one registry request; `latest` is the default.
- **Useful choices only** — de-duplicates rows by version, keeps `latest` and the channel you follow, and never hides the channel that matches the release you are running.
- **In-panel channel selection** — select a meaningful stable, candidate, or preview release directly in the panel; the preference is stored by the DSH Host.
- **Compatibility labels** — explicitly verified versions are marked verified; unknown preview compatibility is marked unverified rather than claimed safe.
- **Copy-only guidance** — generates an installation-kind-aware `@latest`, `@next`, or `@alpha` command but never executes it.
- **Cache without polling** — one Host check on mount, a configurable 30–1,440 minute cache, single-flight registry access, and no frontend polling. Only the Check for updates button bypasses the cache.
- **Mobile-safe panel** — uses a modal browser top layer so the scrollable, safe-area-aware bottom sheet stays above the DSH drawer.

## Install

Requirements:

- DeepSeek Harness with the Web profile
- Node.js 20 or newer
- Verified DSH release: `0.1.6-alpha.2` (also verified on `0.1.6-alpha.1` and `0.1.5-rc.1`)

With an installed `dsh` command:

```sh
dsh plugin --profile web add dsh-update-status@latest
```

From a DeepSeek Harness source checkout:

```sh
corepack enable
pnpm install
pnpm dsh plugin --profile web add dsh-update-status@latest
```

Restart the existing DSH process after installation, then refresh its Web GUI. Do not start a second Web server for this plugin.

Local development link:

```sh
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add "link:$(pwd)"
```

## Usage

1. Open the DSH sidebar drawer. The official fish remains in place; the name row shows `DeepSeek` plus the current version badge.
2. Tap the badge. The update panel opens without triggering the parent New Session action.
3. Review the offered channels. Rows are de-duplicated by version, `latest` and the channel you follow are always listed, and the channel matching the release you are running stays selectable.
4. Select `alpha` or another channel to follow it. The choice is stored by the DSH Host and only affects future checks; an unverified preview stays clearly marked.
5. Copy the generated command and run it yourself in a terminal on the computer hosting DSH.
6. Restart DSH yourself after the package-manager command completes.

Example commands generated for a global install:

```sh
npm install -g @deepseek-ai/dsh@latest
npm install -g @deepseek-ai/dsh@next
npm install -g @deepseek-ai/dsh@alpha
```

The plugin displays one command that matches the detected installation kind and selected channel. It does not run these commands.

### What the dot means

The dot beside the version carries the whole status, and only the update state animates:

| Dot | State | Meaning |
| --- | --- | --- |
| green circle | up to date | The followed channel points at the running release. The chip keeps its normal fill. |
| grey pulse | checking | A status read is in flight (first mount, a channel change, or **Check for updates**). |
| amber dot with a halo | update | The followed channel points at a newer release. Copy the command, run it yourself, restart DSH. |
| chip turns red | failed read | The plugin could not determine the state: the registry read failed, the channel is unpublished, or the versions are not SemVer-comparable. An *unverified* release is not this case — it is an advisory shown only in the panel. |

<p align="center">
  <img src="./assets/sidebar-chip.png" width="300" alt="The version chip in a light shell (grey chip, dark text) and a dark shell (dark grey chip, white text), each showing the green up-to-date dot">
</p>

The chip itself is a neutral second-level surface — grey in both themes, with the theme's own label colour — so the amber halo always reads against it, and it never changes colour to announce an update.

## Release channels

| Channel | Purpose | Compatibility treatment |
| --- | --- | --- |
| `latest` | Default stable/candidate recommended by the DSH npm package | Verified only when explicitly declared by this plugin |
| `next` | Candidate release when it differs meaningfully from the running/stable release | May be unverified |
| `alpha` | Opt-in preview for early evaluation | Unverified unless explicitly declared otherwise |

The plugin honors npm dist-tags. It does not pick the numerically greatest version from registry history.

### What the panel offers

The detail panel and the settings select render the same rows:

- `latest` and the channel you currently follow are always present.
- Any other channel appears only when its version differs from every row above it, so a registry that points several tags at one release still reads as one choice.
- The channel that currently points at the release you are running stays selectable. Before `0.1.4` a row whose version equalled the running release was hidden, so an operator on an `alpha` build could not follow the `alpha` line: that row only existed once they already followed it, which left `latest` as the only other row to click.

Following a channel is a statement about **future** releases — it decides which dist-tag this plugin compares against and which command it generates. It never changes what is installed and never installs anything.

## LAN / non-loopback pages

DSH disables Host settings persistence for any page whose origin is not a loopback authority (the official `dsh-client-ui-settings` README states it plainly: *Non-loopback pages get no durable settings*). `settingsScope` then answers `unavailable` and never sends `settings.describe`, and `connection.isLoopback` reads false for the whole page.

From `0.1.2` this plugin is fully usable there anyway:

- The version/update **status** is fetched normally. Earlier releases gated the whole feature on `connection.isLoopback === true`, so a page reached through a LAN bridge (`dsh-bridge`, `dsh-lan-proxy`, …) never sent `POST /api/dsh-update-status.get-status`, could not open the detail panel, and showed this bundle's declared compatible release as if it were the running version. That gate is gone — the Connection RPC is authenticated and the Host route is the plugin's own.
- **Preferences** (`sidebarEnabled`, `channel`, `cacheTtlMinutes`) keep reading and writing the ONE shared Host namespace `dsh-update-status`, through the same public Remote the official settings client speaks (`settings.describe` / `settings.mutate`). Writes stay revision-fenced, and a refused write surfaces as a conflict instead of a silent overwrite. The direct channel opens only when the official scope reports `unavailable`, so a loopback page keeps the official path and pays no extra wire read.

If you want DSH's stock policy instead (a non-loopback page never persists settings), let the bridge declare itself the Host: inject `window.__DSH_TRANSPORT__ = { fetch: (input, init) => window.fetch(input, init), ownsHost: true }` into the served HTML before `__DSH_BOOT__`. DSH's `ctx.connection.isLoopback` then reads true and every settings-backed surface — including the official Settings pages — comes back. The `dsh-mobile` gateway already does this.

## Compatibility

Current npm release: plugin **`0.1.4`** is verified against DeepSeek Harness **`0.1.6-alpha.1`**.

The `main` branch is ahead of npm and is soaking before its release. It is verified against DeepSeek Harness **`0.1.6-alpha.2`**; see the `Unreleased` section of [`CHANGELOG.md`](CHANGELOG.md).

### Which plugin version goes with which DeepSeek Harness version

| Plugin | Verified DeepSeek Harness | On npm | What that version is |
| --- | --- | --- | --- |
| `main` (unreleased) | `0.1.6-alpha.2`, `0.1.6-alpha.1`, `0.1.5-rc.1` | **not published** | Amber breathing dot instead of a repainted chip, neutral grey chip surface in both themes, green up-to-date dot, advisory notices no longer repaint the chip |
| **`0.1.4`** | `0.1.6-alpha.1`, `0.1.5-rc.1` | `latest` | Fixes the unselectable "channel you are running"; preference writes locked by tests |
| `0.1.3` | `0.1.6-alpha.1`, `0.1.5-rc.1` | published | Carries the `0.1.2` LAN (non-loopback) fix, re-verified on 0.1.6 and locked by tests |
| `0.1.2` | `0.1.5-rc.1` | **never published** | Removed the `connection.isLoopback` gate, so LAN pages work |
| `0.1.1` | `0.1.5-rc.1` | published | The previous npm `latest`; the plugin is inert on LAN/non-loopback pages |
| `0.1.0` | `0.1.2-rc.1` | published | First release |

- **Verified DeepSeek Harness** is the exact DSH release that plugin build was tested against. The list has one source of truth in two places — `VERIFIED_DSH_VERSIONS` in [`src/shared/types.ts`](src/shared/types.ts) and `dsh.compatibility.dshReleases` in [`package.json`](package.json) — and a test keeps them identical. A release that is not on the list is not declared compatible: verify it manually first, and if it turns out incompatible, disable or uninstall the plugin rather than patching DSH core. A release that is merely *not listed yet* is reported as **unverified**: that is an advisory in the panel only, and it never repaints the chip — an operator who upgrades DSH ahead of this plugin keeps a normal chip.
- **On npm** is what `dsh plugin --profile web add dsh-update-status@latest` actually installs. A version that exists in this repository but not on npm is a development state, not a release.
- Match them explicitly when it matters:

  ```sh
  dsh plugin --profile web add dsh-update-status@0.1.4   # DSH 0.1.6-alpha.1 or 0.1.5-rc.1
  dsh plugin --profile web add dsh-update-status@0.1.0   # DSH 0.1.2-rc.1 only
  ```

- Per-release notes — what changed, who is affected, what to do — are hand-written in Chinese and English and become the GitHub Release body: [`v0.1.4`](https://github.com/idoall/dsh-update-status/blob/main/docs/releases/v0.1.4.md) · [`v0.1.3`](https://github.com/idoall/dsh-update-status/blob/main/docs/releases/v0.1.3.md) (covers the never-published `0.1.2`).

## Configuration

| Option | Default | Range / behavior |
| --- | --- | --- |
| `cacheTtlMinutes` | `360` | 30–1,440 minutes; expires only for the next on-demand read, never a background timer |
| `channel` | `latest` | `latest`, `next`, or `alpha` |
| `sidebarEnabled` | `true` | Hides only this plugin's sidebar entry |

**Settings → Version & updates** lets the local operator hide the plugin's sidebar entry and select a release channel. The panel also supports direct channel selection and a cache-duration input. Changing the duration does not issue a request; only a later normal read can refresh an expired cache, while **Check for updates** always performs an immediate manual refresh.

A preference is written only by your own selection in the panel or in that settings section. The plugin has no automatic write path — no effect, timer, or mount-time write — and `tests/client/entry.spec.ts` mounts the real client entry to keep it that way. The values live in the `dsh-update-status` namespace of `~/.dsh/settings.yaml`; edit or remove them there to reset a preference, and DSH reloads the document on the next change.

## Troubleshooting

**The chip shows a version that is not what I just installed, and tapping it does nothing.**
That is the `connection.isLoopback` gate from plugin `0.1.1` and earlier: on a non-loopback page such as a LAN bridge (`dsh-bridge`, `dsh-lan-proxy`) the whole plugin goes inert and the chip falls back to this bundle's declared compatible release. Check what is installed and upgrade:

```sh
node -p "require(process.env.HOME + '/.dsh/profiles/web/node_modules/dsh-update-status/package.json').version"   # 0.1.3 or newer
dsh plugin --profile web add dsh-update-status@latest
```

**The chip turned red right after I upgraded DSH.**
On `main` a red chip means one thing: the plugin could not determine the update state — the registry read failed, the channel is unpublished, or the versions are not SemVer-comparable. Up to `0.1.4` the rule was broader: the client treated **any** warning as a problem, and *"this preview has not been verified against the plugin"* is exactly the warning a DSH release newer than the plugin's list produces. Upgrading DSH ahead of the plugin therefore painted the chip red even though the read had succeeded. `main` splits the two — `failure` still repaints, an advisory stays in the panel — so install that build (the local-development link flow above, or the next npm release) if you keep DSH ahead of this plugin. Until then, following a channel whose release is on the verified list avoids the warning.

**The channel I want is missing from the list.**
Rows are de-duplicated by version: when two tags point at the same release only the first is rendered. Selecting `latest` first re-projects the cache and can surface a preview row that was collapsed behind it. `0.1.4` also stopped hiding the channel that matches the running release.

**The version never changes.**
The Host caches one registry response, 360 minutes by default, and only a normal read can expire it. Press **Check for updates** for an immediate refresh, or lower `cacheTtlMinutes`. A failed check keeps the last good cache and shows the warning next to the version.

**Nothing reaches the npm registry.**
The plugin reports the failure and still shows the locally detected running version. Registry access is HTTPS-only to `registry.npmjs.org`; a proxy or offline host produces that warning rather than a wrong version.

## Security boundary

- Registry access is limited to HTTPS `registry.npmjs.org`; redirects are rejected.
- The Host returns ordinary JSON over the authenticated DSH Connection RPC channel.
- There is no public Remote Service and no model Tool.
- No package-manager process is spawned by plugin code.
- `canApplyInPlace` is always `false`.
- There is no Update now button, automatic install, restart, rollback, or release-file replacement.
- A failed refresh retains the last good cache and displays a warning; a cold failure still shows the local version.

## Uninstall

```sh
dsh plugin --profile web remove dsh-update-status
```

Restart DSH and refresh the Web GUI. If desired, remove the `dsh-update-status` settings namespace from `~/.dsh/settings.yaml` after uninstalling.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run test
pnpm run build
pnpm pack --dry-run
```

Release tags use npm Trusted Publishing with GitHub OIDC. See [docs/RELEASING.md](docs/RELEASING.md) to configure npm’s Trusted Publisher once, then push a matching `vX.Y.Z` tag; no long-lived npm token is stored in this repository.

MIT. See [LICENSE](LICENSE).
