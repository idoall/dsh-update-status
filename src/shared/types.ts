/**
 * JSON-only contract shared by the Host and Web halves.
 *
 * The static package uses the authenticated Connection RPC channel because
 * `harness.handle` / `host.call` are dynamic-Cordis-only closure APIs. The
 * endpoint vocabulary remains deliberately small and private to this plugin
 * channel.
 *
 * There is ONE release line, not a channel catalogue: the Host reports the
 * newest version the npm registry publishes under any dist-tag, and the client
 * compares it with the running version. `latest`, `next` and `alpha` are npm's
 * bookkeeping, not a user choice this plugin asks anyone to make.
 */

export const PLUGIN_ID = 'dsh-update-status'
export const PACKAGE_NAME = '@deepseek-ai/dsh'
/** Shared Connection RPC channel. Custom prefixes 405 on the SPA fallback. */
export const UPDATE_STATUS_CHANNEL = '/api'
export const RELEASES_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases'
/**
 * DSH releases this bundle has actually been verified against. The same list is
 * declared in package.json's `dsh.compatibility.dshReleases`, and every other
 * release the registry reports stays `unverified` — the plugin never claims a
 * compatibility nobody checked.
 */
export const VERIFIED_DSH_VERSIONS: readonly string[] = ['0.1.7-alpha.2', '0.1.7-rc.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-alpha.1']
export const DEFAULT_CACHE_TTL_MINUTES = 360
export const MIN_CACHE_TTL_MINUTES = 30
export const MAX_CACHE_TTL_MINUTES = 1_440

export function isCacheTtlMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_CACHE_TTL_MINUTES && value <= MAX_CACHE_TTL_MINUTES
}

export const UPDATE_ENDPOINTS = {
  getStatus: 'dsh-update-status.get-status',
  checkUpdate: 'dsh-update-status.check-update',
} as const

/** Restart RPC remains on the same authenticated Connection `/api` channel. */
export const RESTART_ENDPOINTS = {
  status: 'dsh-update-status.restart-status',
  check: 'dsh-update-status.restart-check',
  request: 'dsh-update-status.restart',
} as const

export type UpdateEndpoint = (typeof UPDATE_ENDPOINTS)[keyof typeof UPDATE_ENDPOINTS]
export type RestartEndpoint = (typeof RESTART_ENDPOINTS)[keyof typeof RESTART_ENDPOINTS]
export type ReleaseCompatibility = 'verified' | 'unverified' | 'incompatible'
/**
 * Severity of `warning`, so a surface can tell "the plugin could not determine
 * the update state" from "here is something worth knowing".
 *
 * - `failure`: no usable answer — a failed registry read, or a version SemVer
 *   cannot compare. This is what justifies repainting the sidebar chip.
 * - `notice`: the answer is complete and usable; the text is advisory, e.g. a
 *   newer release this bundle has not been verified against. The chip must NOT
 *   repaint for this — an operator upgrading DSH ahead of the plugin would
 *   otherwise see the chip turn red for a plugin-side bookkeeping fact.
 *
 * Optional on purpose: a Host older than this field leaves it `undefined`, and
 * the client then falls back to treating any warning as a failure.
 */
export type UpdateWarningKind = 'failure' | 'notice'
export type InstallKind = 'npm-global' | 'pnpm-global' | 'source-checkout' | 'unknown'

/** Language-neutral warning facts; the browser renders them in its own locale. */
export type UpdateWarning =
  | { code: 'registry-unavailable'; detail: string }
  | { code: 'version-incomparable'; currentVersion: string; latestVersion: string }
  /** A newer release exists, but this bundle has not been tested against it. */
  | { code: 'version-unverified'; version: string }
  /**
   * The Host resolved a `@deepseek-ai/schemastery` that DSH does not ship, so the
   * Loader's volatile projection is unavailable and the preference fields cannot
   * be marked volatile. Advisory: the version answer itself is complete, and the
   * text carries the exact directory to remove. See `host/schemastery.ts`.
   */
  | { code: 'stale-schemastery'; version: string | null; path: string; nodeModulesDir: string | null }

/** Arguments accepted by either read/check endpoint. */
export interface CheckUpdateRequest {
  force?: boolean
  /** User preference, bounded by the Host before it affects cache expiry. */
  cacheTtlMinutes?: number
}

/**
 * A lossless, JSON-serializable snapshot used by both browser surfaces.
 * Nulls are intentional: a failed first check must still render a truthful
 * current-version card instead of an empty or malformed UI.
 */
export interface UpdateStatus {
  currentVersion: string
  /** Newest version the registry publishes under any dist-tag; null when unknown. */
  latestVersion: string | null
  hasUpdate: boolean
  /** Whether this bundle was verified against `latestVersion`. */
  compatibility: ReleaseCompatibility
  cached: boolean
  checkedAt: string | null
  /** English fallback for older clients; current clients localize `warnings`. */
  warning: string | null
  /** Severity of `warning`; absent from a Host older than the field. */
  warningKind?: UpdateWarningKind | null
  /** Structured warning facts; absent from a Host older than this field. */
  warnings?: UpdateWarning[]
  installKind: InstallKind
  upgradeCommand: string
  releaseUrl: string
  changelogUrl: string
  publishedAt: string | null
  packageName: string
  /** Phase 1 is informational only; the GUI must never apply an update. */
  canApplyInPlace: false
}
