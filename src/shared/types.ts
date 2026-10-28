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
/**
 * Severity of `warning`, so a surface can tell "the plugin could not determine
 * the update state" from "here is something worth knowing".
 *
 * - `failure`: no usable answer — a failed registry read, or a version SemVer
 *   cannot compare. This is what justifies repainting the sidebar chip.
 * - `notice`: the answer is complete and usable; the text is advisory, e.g. the
 *   Host resolved a stale copy of a shared library. The chip must NOT repaint for
 *   this — an operator upgrading DSH ahead of the plugin would otherwise see the
 *   chip turn red for a plugin-side bookkeeping fact.
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
  /**
   * The Host resolved a `@deepseek-ai/schemastery` that DSH does not ship, so the
   * Loader's volatile projection is unavailable and the preference fields cannot
   * be marked volatile. Advisory: the version answer itself is complete, and the
   * text carries the exact directory to remove. See `host/schemastery.ts`.
   */
  | { code: 'stale-schemastery'; version: string | null; path: string; nodeModulesDir: string | null }

/**
 * One published version that is newer than the running one.
 *
 * The plugin's only job is to say "a newer version exists, here is how to get
 * it", so a candidate carries the version, the npm dist-tag that publishes it,
 * when it was published, its release line, and a copy-only command when the
 * detected installation kind actually accepts one.
 */
export interface ReleaseCandidate {
  version: string
  /** The npm dist-tag carrying this version; null when the Host could not tell. */
  tag: string | null
  publishedAt: string | null
  /** Numeric release line, e.g. `0.2.1` for `0.2.1-rc.4`. */
  line: string
  /** Copy-only upgrade command, or null when this installation cannot be upgraded that way. */
  command: string | null
}

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
  /**
   * Every published version strictly newer than `currentVersion`, highest first.
   * Empty means "you are on the newest published version" — never a placeholder.
   */
  releases: ReleaseCandidate[]
  hasUpdate: boolean
  cached: boolean
  checkedAt: string | null
  /** English fallback for older clients; current clients localize `warnings`. */
  warning: string | null
  /** Severity of `warning`; absent from a Host older than the field. */
  warningKind?: UpdateWarningKind | null
  /** Structured warning facts; absent from a Host older than this field. */
  warnings?: UpdateWarning[]
  installKind: InstallKind
  releaseUrl: string
  changelogUrl: string
  packageName: string
  /** Phase 1 is informational only; the GUI must never apply an update. */
  canApplyInPlace: false
}
