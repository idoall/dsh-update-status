/**
 * JSON-only contract shared by the Host and Web halves.
 *
 * The static package uses the authenticated Connection RPC channel because
 * `harness.handle` / `host.call` are dynamic-Cordis-only closure APIs in DSH
 * 0.1.5-rc.1. The endpoint vocabulary remains deliberately small and private
 * to this plugin channel.
 */

export const PLUGIN_ID = 'dsh-update-status'
export const PACKAGE_NAME = '@deepseek-ai/dsh'
/** Shared Connection RPC channel. Custom prefixes 405 on the SPA fallback. */
export const UPDATE_STATUS_CHANNEL = '/api'
export const RELEASES_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases'
/** Exact DSH release this bundle declares compatible in package.json. */
export const STATIC_COMPATIBLE_VERSION = '0.1.5-rc.1'
export const RELEASE_CHANNELS = ['latest', 'next', 'alpha'] as const
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

export type UpdateEndpoint = (typeof UPDATE_ENDPOINTS)[keyof typeof UPDATE_ENDPOINTS]
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]
export type ReleaseCompatibility = 'verified' | 'unverified' | 'incompatible'
export type InstallKind = 'npm-global' | 'pnpm-global' | 'source-checkout' | 'unknown'

export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return value === 'latest' || value === 'next' || value === 'alpha'
}

export interface ChannelRelease {
  channel: ReleaseChannel
  version: string | null
  publishedAt: string | null
  compatibility: ReleaseCompatibility
}

/** Arguments accepted by either read/check endpoint. */
export interface CheckUpdateRequest {
  force?: boolean
  channel?: ReleaseChannel
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
  latestVersion: string | null
  hasUpdate: boolean
  cached: boolean
  checkedAt: string | null
  warning: string | null
  installKind: InstallKind
  upgradeCommand: string
  releaseUrl: string
  changelogUrl: string
  publishedAt: string | null
  packageName: string
  /** Selected npm dist-tag used for comparison and command generation. */
  channel: ReleaseChannel
  /** All supported dist-tags returned by the same cached registry request. */
  channels: ChannelRelease[]
  /** Phase 1 is informational only; the GUI must never apply an update. */
  canApplyInPlace: false
}

/** Persisted browser preference served through the ordinary DSH settings seam. */
export interface UpdateStatusSettings {
  sidebarEnabled: boolean
  channel: ReleaseChannel
  /** On-demand npm-registry cache duration. This never starts a browser timer. */
  cacheTtlMinutes: number
}
