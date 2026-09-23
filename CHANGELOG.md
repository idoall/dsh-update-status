# Changelog

All notable changes to this project are documented here.

## 0.1.7 — 2026-09-24

Verified DeepSeek Harness: `0.1.7-rc.1` (the latest release candidate) and `0.1.7-alpha.2`. Full bilingual release notes: [`docs/releases/v0.1.7.md`](docs/releases/v0.1.7.md).

`0.1.6` made the plugin work on the DSH `0.1.7` line; `0.1.7` makes it speak the page's language. Contributed by [@ivkiwi](https://github.com/ivkiwi) as PR #7, rebased onto `0.1.6` and landed with the original authorship preserved (commit `362d83e`). No migration is needed from `0.1.6`.

- **Runtime warnings are language-neutral now (the user-visible fix).** The Host used to compose the warning sentences itself, in Chinese (`无法检查 npm registry：…`, `npm registry 未发布 alpha 通道。`, …), and the Client displayed that string verbatim — so an English UI showed Chinese warnings. `UpdateStatus` now carries `warnings: UpdateWarning[]` with four codes (`registry-unavailable`, `channel-unavailable`, `version-incomparable`, `preview-unverified`) and their interpolation data, and the Client renders them from its own `en` / `zh` dictionary. The English `warning` string is **kept as a mixed-version fallback**, so a new client against an older Host — or an older client against a new Host — still shows a useful English sentence.
- **The `warningKind` contract is unchanged.** All `preview-unverified` → `notice` (advisory, never repaints the chip); anything else → `failure`. The `0.1.5` rule that keeps "DSH upgraded ahead of the plugin" from painting the chip red still holds.
- **The Client validates the structured payload at the boundary.** A new `warningOf` guard checks each code and its interpolation types, so a malformed payload is dropped rather than rendered as `[object Object]`.
- **Non-command installation guidance is localized too**, while **real upgrade commands (`npm install -g …` / `pnpm add -g …`) pass through untouched** — a command can never be corrupted by translation.
- **Dev toolchain bumped** (development dependencies only, not in the published artifact): tsdown `0.22.14` → `0.23.0`, vitest `4.1.11` → `5.0.1`.
- **Tests: 98 passing** (up from 94). Four new `tests/client/i18n.spec.ts` specs cover English and Chinese rendering of structured warnings, the structured-preferred/legacy-fallback path, and installation guidance that localizes without altering real commands.
- **Unchanged**: the `0.1.6` adaptation (volatile `Config` form, `ctx.configForms` channel, profile-patch storage), the status read, the RPC channel, the sidebar chip, the detail panel and the LAN fallback.

## 0.1.6 — 2026-09-23

Verified DeepSeek Harness: `0.1.7-rc.1` (the latest release candidate) and `0.1.7-alpha.2`. Full bilingual release notes: [`docs/releases/v0.1.6.md`](docs/releases/v0.1.6.md).

**`0.1.6` supports the DSH `0.1.7` line only.** DSH `0.1.7` removed the two APIs this plugin was built on, so `0.1.5` could not read or write a single preference there: `ctx.settings.register(ns, schema, options)` is gone (the settings service now projects the volatile `Config` fields of each active Loader entry, and a form namespace IS the entry id), and the `ctx.settingsScope` client service is gone too. On an older DSH — including `0.1.6-alpha.2` — stay on `0.1.5`.

- **Host half: the preferences are now the plugin entry's own volatile `Config`.** `src/host/settings.ts` no longer calls `settings.register`. It exports one schema — deployment fields `cacheTtlHours` / `timeoutMs` / `autoCheckOnMount` (ordinary, never projected into the form) plus user preferences `sidebarEnabled` / `channel` / `cacheTtlMinutes` (all `.volatile()`) — so an edit commits into the running references and emits one `loader/volatile-update` instead of remounting the plugin. The namespace is the Loader entry id `dsh-update-status` (`cordis.patch.yml`'s `id`), which is now the storage key and must not change.
- **Storage moved to the profile patch.** The preferences persist as that entry's `config` in the active profile's `cordis.patch.yml` — DSH 0.1.7's official plugin-preference model. The `~/.dsh/settings.yaml` namespace this plugin used before no longer exists; DSH imports a leftover section into the same-id entry once.
- **Client half: `ctx.settingsScope` → `ctx.configForms.get(entryId)`.** The new `src/client/settings/configFormScope.ts` projects the official form (`@deepseek-ai/dsh-client-ui-settings`, DSH 0.1.7's successor of the removed service) onto the plugin's own scope contract. A refused write (`set` answering `false`) becomes a rejection, so the settings page surfaces a conflict instead of pretending the edit landed; a transport fault rejects too. `src/client/settings/scopeFaces.ts` drops the dead `settingsScope` binder guard.
- **The generic auto-generated settings page is suppressed** with `settings.configure({ auto: false })`, because the plugin already ships its own `settings.section` page. The entry's row stays in `settings.describe()` either way.
- **`@deepseek-ai/schemastery` is a peer now**, with a devDependency for this repository's own tests: DSH 0.1.7 resolves only a LINKED plugin's peer dependencies from the running installation, so a plain dependency made the Host half fail to import from a `link:` install.
- **Compatibility declarations corrected.** `dsh.engines.dsh` and `peerDependencies['@deepseek-ai/dsh-settings']` both declare `>=0.1.7-alpha.2 <0.2.0` — the lower bound names the alpha on purpose, because node-semver's default prerelease rule does not admit `0.1.7-alpha.2` under a `>=0.1.6-0` lower bound. `dsh.manifestVersion` is declared, `dsh.client.inject` gains `@deepseek-ai/dsh-api-remotes`, and `dsh.compatibility.dshReleases` / `VERIFIED_DSH_VERSIONS` list `0.1.7-alpha.2` and `0.1.7-rc.1`. DSH `0.1.7-rc.1` refuses an incompatible bundle at profile load, so these ranges are load-bearing.
- **No change to the status read, the RPC channel, the sidebar chip, the detail panel or the LAN (non-loopback) fallback.** `connection.fetch.register` still serves the exact `/api/dsh-update-status.*` routes, the browser `connection.rpc` face is unchanged, and the slot contracts the plugin uses (`sidebar.brand.name` single with lowest-priority-wins, `sidebar.footer.action` / `shell.overlay` / `settings.section` lists) still match.
- **Tests: 94 passing** (up from 70). New `tests/host/settings.spec.ts` locks the volatile field set, the preference defaults, the entry-id-is-namespace invariant and the page policy; new `configFormScope` specs in `tests/client/settingsChannel.spec.ts` cover the projection, the refusal translation and the memory-mode fallback; `tests/shared/compatibility.spec.ts` now also proves the engines and peer ranges ADMIT every verified release and that schemastery stays a peer.

## 0.1.5 — 2026-09-18

Verified DeepSeek Harness: `0.1.6-alpha.2` (also `0.1.6-alpha.1` and `0.1.5-rc.1`). Full bilingual release notes: [`docs/releases/v0.1.5.md`](docs/releases/v0.1.5.md).

- **The up-to-date state is now a green circle.** The dot beside the version used the chip's `currentColor`, which on the light shell is near-black and on the dark shell near-white: a dot that reads as "off" rather than "you are current". It now uses the theme's success token (`--dsw-alias-state-success-primary`, `#22c55e` in both themes) and is a flat 5px circle — no glow, no animation, so "nothing to do" can never be confused with the update signal. The dot carries a new `data-state` (the value `visualState` already computes), and the precedence is explicit: up-to-date is declared first, then the neutral grey **checking** pulse, then the amber **update** halo, so an in-flight check and a pending update are untouched by this change. The failed-read state keeps the chip's own label colour on the red fill.
- **An advisory notice no longer repaints the chip — the red chip was a classification bug.** DSH `0.1.6-alpha.2` shipped after this bundle's verified list, so the Host honestly reported *"alpha 是预览通道，版本 0.1.6-alpha.2 尚未验证与本插件兼容。"* and the client treated **any** `warning` as a failure: the whole version chip turned solid red (`#ec1313`) on a perfectly healthy read — exactly the "the background colour changed again" surprise the breathing dot was meant to remove. The Host now labels each warning with a `warningKind`: `failure` when it could not produce a usable answer (registry read failed, channel unpublished, versions not SemVer-comparable), `notice` when the answer is complete and the text is merely advisory (an unverified preview). Only `failure` can repaint the chip. A Host older than the field sends none, and the client then keeps the previous "any warning is a problem" behaviour rather than dropping a real failure. The classification moved out of the TSX component into `src/shared/visual-state.ts` so it is unit-tested: advisory → `current`, failure → `problem`, legacy payload → `problem`.
- **Verified against DSH `0.1.6-alpha.2`**, so the running release is recognised instead of flagged: `0.1.6-alpha.2` joins `VERIFIED_DSH_VERSIONS` and `package.json`'s `dsh.compatibility.dshReleases`. A new spec compares the two lists, because their drifting apart is silent.
- **The version chip is now a neutral second-level surface.** It used `label-primary` as its fill with `label-primary-inverted` text, which on the dark shell is a near-white pill with dark text — a white frame that swallowed the amber halo and fought the warn colour. The chip now uses `button-floating-hover`, the one palette surface that is grey in **both** themes (`#f1f3f5` light / `#353638` dark), with `label-primary` text (`#0f1115` light / `#f9fafb` dark): a light grey chip on the light shell, a dark grey chip with white text on the dark one.
- **Light, dark and system are followed automatically, and hover no longer inverts in light mode.** Every rendered colour is a DSH semantic token, so the chip, dot, halo, footer ring and panel follow whichever appearance DSH resolves — including `system`, which tracks the OS — with no plugin-side theme detection and no media query to keep in sync. The old hover used `brightness(1.08)`, which only ever brightens: on the light shell it drove the grey chip to pure white, i.e. made it vanish. Hover now mixes the theme's own label colour into the surface (darkens in light mode, lightens in dark mode) inside an `@supports (background:color-mix(…))` guard, keeping the brightness filter as the fallback for an engine without `color-mix`. Measured: `#f1f3f5` → `#dfe1e3` light, `#353638` → `#454648` dark.
- **The error chip label is theme-correct.** It still repaints red, but now uses the shell's own badge pattern (`bg-layer-3` label) instead of hard-coded white: white on the dark red of the light theme, dark on the light red of the dark theme — both readable, unlike the fixed white text it replaces.
- **A pending update no longer repaints the version chip.** The chip used to flip to a solid amber fill (`warn-primary`) the moment a newer release existed, which recoloured the whole brand row for a state that is not a chip state. The chip now keeps its normal fill in every state, and the only signal is the amber dot beside the version: a 6px dot with a soft halo whose scale and glow breathe together on a 1.6s cycle. The halo is mixed from the theme's own warn colour (`color-mix`) with a literal amber declaration in front of it, so the glow always matches the dot and still renders on an engine without `color-mix`. `prefers-reduced-motion` holds the glow still instead of animating it.
- Styling invariants are locked by `tests/client/styles.spec.ts`: no `data-update` fill rule on the chip, the chip's grey surface and theme label, the theme-mixed hover with its brightness fallback, the error label, the dot's own animation and halo (with its fallback), the update state outranking the loading state, and the reduced-motion escape hatch.

## 0.1.4 — 2026-09-16

Verified DeepSeek Harness: `0.1.6-alpha.1` (also `0.1.5-rc.1`). Full bilingual release notes: [`docs/releases/v0.1.4.md`](docs/releases/v0.1.4.md).

- **Channel-selection deadlock fixed.** `visibleChannelReleases` dropped every channel whose version equalled the running release. While running the release published on `alpha`, the `alpha` row therefore disappeared from both the detail panel and the settings select — the one channel an operator on that line wants to follow could only be seen by already following it. A row is now hidden only when an earlier row already shows the same version; channels that all point at the running release still collapse to one.
- **The preference write path is now covered by tests.** A report of a stored `channel` changing without a gesture prompted a full audit: the only two write sites are the panel's per-channel button and the settings select, and no effect, timer or mount path writes. `tests/client/entry.spec.ts` mounts the real client entry with the official `settingsScope` seam present and asserts that a persisted preference is applied by *reading* and that mount plus teardown issue zero `set()` calls.
- No change to the status read, to LAN (non-loopback) behaviour, or to the Host document shape.

## 0.1.3 — 2026-09-16

Verified DeepSeek Harness: `0.1.6-alpha.1` (also `0.1.5-rc.1`). Full bilingual release notes: [`docs/releases/v0.1.3.md`](docs/releases/v0.1.3.md).

- **Contains the whole `0.1.2` LAN fix**, because `0.1.2` was never published to npm: upgrading from npm moves `0.1.1` → `0.1.3` directly.
- **Re-verified on DSH `0.1.6-alpha.1`.** Host and client halves were checked against the running 0.1.6 composition: `connection.fetch.register` still serves exact `/api/dsh-update-status.*` routes ahead of the shared Typert interceptor, the browser `connection.rpc` face is unchanged, and the slot contracts the plugin uses (`sidebar.brand.name` single with lowest-priority-wins, `sidebar.footer.action` / `shell.overlay` / `settings.section` lists) still match.
- **LAN page regression locked in tests.** `tests/client/entry.spec.ts` drives the real client entry against a structural Cordis context and asserts that the Host status read is issued from a non-loopback page, that the chip keeps shadowing the official wordmark, and that the lifecycle effect owns teardown — the exact wiring whose `connection.isLoopback === true` gate made the plugin inert on a bridge-served page.
- **Compatibility is now a verified-release list** (`VERIFIED_DSH_VERSIONS`) instead of a single version, so `0.1.5-rc.1` and `0.1.6-alpha.1` are both labelled *verified* while every untested release stays *unverified*. `package.json`'s `dsh.compatibility.dshReleases` declares the same two releases.
- **Release process**: every tag now requires a hand-written bilingual `docs/releases/vX.Y.Z.md`, and the GitHub Release body is that file instead of generated commit titles.
- No behavioural change on a loopback page; the LAN fix from `0.1.2` is unchanged.

## 0.1.2 — 2026-09-16

**Never published to npm** — its changes ship in `0.1.3`. The tag-side release notes for it live inside [`docs/releases/v0.1.3.md`](docs/releases/v0.1.3.md).

Verified DeepSeek Harness: `0.1.5-rc.1`.

- **LAN / non-loopback pages**: the status panel no longer stays inert when the Web UI is reached from another machine through a LAN bridge (`dsh-bridge`, `dsh-lan-proxy`, …). The client half used to gate the whole feature on `connection.isLoopback === true`, so on a LAN page it never sent `POST /api/dsh-update-status.get-status`, the detail panel could not open, and the sidebar chip showed this bundle's declared compatible release (`0.1.5-rc.1`) as if it were the running version. That gate is removed: the Connection RPC is authenticated and the Host route is the plugin's own, so the read-only status is fetched from whichever page the operator is on, and a page without a usable transport now reports an honest error instead of a fabricated version.
- **LAN / non-loopback pages — preferences**: DSH disables Host settings *persistence* on non-loopback pages (`dsh-client-ui-settings`: `persistence = ctx.remote.$host.isLoopback ? "host" : "memory"`, so `settingsScope` starts `unavailable` and never crosses the wire; README: *Non-loopback pages get no durable settings*). `sidebarEnabled`, `channel` and `cacheTtlMinutes` therefore all fell back to their defaults there — silently switching the followed release line away from the Host's configured one. The plugin now opens a direct Host channel over the same public Remote the official settings client speaks (`settings.describe` / `settings.mutate`), so the one shared `dsh-update-status` namespace keeps serving every device.
- The official scope stays authoritative whenever it is not `unavailable`, so a loopback page keeps the official semantics and pays no extra wire read; the direct channel is opened lazily, at most once, and only for the documented non-loopback degradation.
- The direct channel keeps the official snapshot shape (value/base/user/revision/writable/mode), serializes writes in issue order, fences them by the namespace revision, and rejects a refused write with the Host code after a recovery read instead of pretending the edit landed.
- Reads are contained: the injected context refuses the dotted parent (`payload.remote` throws `cannot get property "remote" without inject`), so the literal service key is read first and every read is guarded — one unreadable member can no longer abort the whole settings wiring.
- The direct channel refreshes on `settings/document-updated` and on `connection/reset`, so a LAN device stays in step with edits made elsewhere.
- Tests: 21 new cases (channel selection, direct-scope semantics and guards, loopback write routing, LAN preferences regression).

## 0.1.1 — 2026-09-10

Verified DeepSeek Harness: `0.1.5-rc.1`.

- Adapted the Web client half to DeepSeek Harness `0.1.5-rc.1`.
- Dropped `@deepseek-ai/dsh-client-ui-slots` from `dsh.client.inject` (it is a frozen platform module, not a boot-graph plugin).
- Fitted the sidebar version chip to the 24px `sidebar.brand.name` row used by the current shell.
- Moved Host RPC onto authenticated `POST /api/dsh-update-status.*` Fetch routes so the SPA fallback no longer answers with HTTP 405.

## 0.1.0 — 2026-09-10

- Added a static DeepSeek Harness Web Cordis plugin with a read-only Host update-status service.
- Added npm `latest`, `next`, and `alpha` dist-tag discovery through one HTTPS-allowlisted, timeout-bounded registry request.
- Added a six-hour process cache, single-flight behavior, prerelease-aware SemVer comparison, and failed-refresh fallback.
- Added `sidebar.brand.name` replacement (`DeepSeek + status Badge`) without replacing the official fish mark.
- Added a collapsed-rail `sidebar.footer.action` fallback.
- Added a modal top-layer detail panel and safe-area-aware mobile bottom sheet that stays above the sidebar drawer.
- Added persisted channel selection in Settings and directly in the detail panel.
- Added meaningful-channel filtering: redundant same-version candidates are hidden and duplicate releases favor `latest`.
- Added verified/unverified compatibility labels and channel-specific copy-only commands.
- Added automated tests for Host RPC, registry parsing, caching, channel projection, client stores, SemVer, and channel presentation.

No package-manager execution, automatic installation, restart, rollback, release download, or in-place file replacement is implemented.
