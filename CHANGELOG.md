# Changelog

All notable changes to this project are documented here.

## 0.1.2 — 2026-09-16

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
