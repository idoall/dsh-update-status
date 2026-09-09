/**
 * Read-only npm-registry update checker with process-local TTL cache and
 * single-flight coordination. One registry response captures every supported
 * dist-tag; selecting a channel only re-projects the cached document.
 */

import type { InstallationInfo } from './installation.ts'
import { upgradeCommandFor } from './installation.ts'
import { compareSemver } from '../shared/semver.ts'
import {
  PACKAGE_NAME,
  RELEASES_URL,
  RELEASE_CHANNELS,
  STATIC_COMPATIBLE_VERSION,
  type ChannelRelease,
  type ReleaseChannel,
  type ReleaseCompatibility,
  type UpdateStatus,
} from '../shared/types.ts'

export const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
export const DEFAULT_TIMEOUT_MS = 15_000

export interface RegistryRelease {
  channels: ChannelRelease[]
}

export type RegistryFetcher = () => Promise<RegistryRelease>

export interface UpdateStatusServiceOptions {
  installation: InstallationInfo
  fetchLatest?: RegistryFetcher
  now?: () => number
  ttlMs?: number
  releaseUrl?: string
}

interface CachedRelease {
  release: RegistryRelease
  checkedAtMs: number
}

function boundedMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed === '' ? 'unknown error' : trimmed.slice(0, 220)
}

function warningWith(base: string | null, addition: string | null): string | null {
  if (base === null || base === '') return addition
  if (addition === null || addition === '') return base
  return `${base} ${addition}`
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function compatibilityOf(version: string | null): ReleaseCompatibility {
  return version === STATIC_COMPATIBLE_VERSION ? 'verified' : 'unverified'
}

export function registryReleaseOf(value: unknown): RegistryRelease {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('npm registry returned an invalid document')
  const record = value as Record<string, unknown>
  const tags = record['dist-tags']
  if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) throw new Error('npm registry response has no dist-tags')
  const tagRecord = tags as Record<string, unknown>
  const time = record.time
  const timeRecord = time !== null && typeof time === 'object' && !Array.isArray(time)
    ? time as Record<string, unknown>
    : {}
  const channels = RELEASE_CHANNELS.map((channel): ChannelRelease => {
    const raw = tagRecord[channel]
    const version = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
    return {
      channel,
      version,
      publishedAt: version === null ? null : dateOrNull(timeRecord[version]),
      compatibility: compatibilityOf(version),
    }
  })
  if (channels.every(release => release.version === null)) throw new Error('npm registry response has no supported dist-tags')
  return { channels }
}

/** Only the explicitly approved HTTPS npm Registry authority may be contacted. */
export function assertApprovedRegistryUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username !== '' || url.password !== '') {
    throw new Error('update check rejected a non-whitelisted registry URL')
  }
  return url
}

/** Create the default HTTPS-only registry reader. */
export function createRegistryFetcher(timeoutMs: number = DEFAULT_TIMEOUT_MS): RegistryFetcher {
  const boundedTimeout = Math.max(1_000, Math.min(30_000, Math.floor(timeoutMs)))
  return async () => {
    const url = assertApprovedRegistryUrl(REGISTRY_URL)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, boundedTimeout)
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        // npm's install-v1 abbreviated packument omits the `time` map. The
        // complete JSON document is required to display per-channel publish dates.
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
      return registryReleaseOf(await response.json())
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`npm registry timed out after ${boundedTimeout}ms`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

export class UpdateStatusService {
  private readonly installation: InstallationInfo
  private readonly fetchLatest: RegistryFetcher
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly releaseUrl: string
  private cache: CachedRelease | undefined
  private inFlight: Promise<CachedRelease> | undefined

  constructor(options: UpdateStatusServiceOptions) {
    this.installation = options.installation
    this.fetchLatest = options.fetchLatest ?? createRegistryFetcher()
    this.now = options.now ?? Date.now
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS))
    this.releaseUrl = options.releaseUrl ?? RELEASES_URL
  }

  getStatus(channel: ReleaseChannel = 'latest'): Promise<UpdateStatus> {
    return this.check(false, channel)
  }

  /** `force` bypasses TTL but still joins any registry check already in flight. */
  async check(force: boolean = false, channel: ReleaseChannel = 'latest'): Promise<UpdateStatus> {
    const cached = this.cache
    if (!force && cached !== undefined && this.now() - cached.checkedAtMs < this.ttlMs) {
      return this.statusFromCache(cached, channel, true, null)
    }
    if (this.inFlight !== undefined) {
      try {
        return this.statusFromCache(await this.inFlight, channel, false, null)
      } catch (error) {
        return this.statusAfterFailure(channel, error)
      }
    }

    const run = this.refreshRelease()
    this.inFlight = run
    try {
      return this.statusFromCache(await run, channel, false, null)
    } catch (error) {
      return this.statusAfterFailure(channel, error)
    } finally {
      if (this.inFlight === run) this.inFlight = undefined
    }
  }

  private async refreshRelease(): Promise<CachedRelease> {
    const cache = { release: await this.fetchLatest(), checkedAtMs: this.now() }
    this.cache = cache
    return cache
  }

  private statusAfterFailure(channel: ReleaseChannel, error: unknown): UpdateStatus {
    const warning = `无法检查 npm registry：${boundedMessage(error)}`
    return this.cache === undefined
      ? this.statusWithoutRemoteRelease(channel, warning)
      : this.statusFromCache(this.cache, channel, true, warning)
  }

  private statusFromCache(cache: CachedRelease, channel: ReleaseChannel, cached: boolean, initialWarning: string | null): UpdateStatus {
    const selected = cache.release.channels.find(release => release.channel === channel)
      ?? { channel, version: null, publishedAt: null, compatibility: 'unverified' as const }
    const comparison = selected.version === null ? undefined : compareSemver(this.installation.currentVersion, selected.version)
    const missingWarning = selected.version === null ? `npm registry 未发布 ${channel} 通道。` : null
    const comparisonWarning = selected.version !== null && comparison === undefined
      ? `无法按 SemVer 比较当前版本 ${this.installation.currentVersion} 与 ${channel} 通道版本 ${selected.version}。`
      : null
    const previewWarning = channel !== 'latest' && selected.version !== null && selected.compatibility !== 'verified'
      ? `${channel} 是预览通道，版本 ${selected.version} 尚未验证与本插件兼容。`
      : null
    return {
      currentVersion: this.installation.currentVersion,
      latestVersion: selected.version,
      hasUpdate: comparison !== undefined && comparison < 0,
      cached,
      checkedAt: new Date(cache.checkedAtMs).toISOString(),
      warning: warningWith(warningWith(initialWarning, missingWarning), warningWith(comparisonWarning, previewWarning)),
      installKind: this.installation.installKind,
      upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || PACKAGE_NAME, channel),
      releaseUrl: this.releaseUrl,
      changelogUrl: this.releaseUrl,
      publishedAt: selected.publishedAt,
      packageName: this.installation.packageName || PACKAGE_NAME,
      channel,
      channels: cache.release.channels,
      canApplyInPlace: false,
    }
  }

  private statusWithoutRemoteRelease(channel: ReleaseChannel, warning: string): UpdateStatus {
    return {
      currentVersion: this.installation.currentVersion,
      latestVersion: null,
      hasUpdate: false,
      cached: false,
      checkedAt: null,
      warning,
      installKind: this.installation.installKind,
      upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || PACKAGE_NAME, channel),
      releaseUrl: this.releaseUrl,
      changelogUrl: this.releaseUrl,
      publishedAt: null,
      packageName: this.installation.packageName || PACKAGE_NAME,
      channel,
      channels: RELEASE_CHANNELS.map(item => ({ channel: item, version: null, publishedAt: null, compatibility: 'unverified' })),
      canApplyInPlace: false,
    }
  }
}
