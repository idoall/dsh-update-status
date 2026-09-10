# Changelog

All notable changes to this project are documented here.

## 0.1.0 — 2026-09-10

- Added a static DeepSeek Harness Web Cordis plugin with a read-only Host update-status service.
- Added npm `latest`, `next`, and `alpha` dist-tag discovery through one HTTPS-allowlisted, timeout-bounded registry request.
- Added a six-hour process cache, single-flight behavior, prerelease-aware SemVer comparison, and failed-refresh fallback.
- Added `sidebar.brand.name` replacement (`DeepSeek + status Badge`) without replacing the official fish mark; the DeepSeek name remains visible when horizontal space is tight and the Badge truncates first.
- Added a collapsed-rail `sidebar.footer.action` fallback.
- Added a modal top-layer detail panel and safe-area-aware mobile bottom sheet that stays above the sidebar drawer.
- Added persisted channel selection in Settings and directly in the detail panel.
- Added meaningful-channel filtering: redundant same-version candidates are hidden and duplicate releases favor `latest`.
- Added verified/unverified compatibility labels and channel-specific copy-only commands.
- Added automated tests for Host RPC, registry parsing, caching, channel projection, client stores, SemVer, and channel presentation.

No package-manager execution, automatic installation, restart, rollback, release download, or in-place file replacement is implemented.
