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
  DEFAULT_CACHE_TTL_MINUTES,
  isCacheTtlMinutes,
  VERIFIED_DSH_VERSIONS,
  type ChannelRelease,
  type ReleaseChannel,
  type ReleaseCompatibility,
  type UpdateStatus,
  type UpdateWarning,
  type UpdateWarningKind,
} from '../shared/types.ts'

export const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
export const DEFAULT_TTL_MS = DEFAULT_CACHE_TTL_MINUTES * 60 * 1000
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

function warningText(warning: UpdateWarning): string {
  switch (warning.code) {
    case 'registry-unavailable': return `Unable to check the npm registry: ${warning.detail}`
    case 'channel-unavailable': return `The npm registry does not publish a ${warning.channel} channel.`
    case 'version-incomparable': return `Unable to compare the current version ${warning.currentVersion} with ${warning.channel} channel version ${warning.selectedVersion} using SemVer.`
    case 'preview-unverified': return `${warning.channel} is a preview channel; version ${warning.version} has not been verified as compatible with this plugin.`
  }
}

function warningFallback(warnings: UpdateWarning[]): string | null {
  return warnings.length === 0 ? null : warnings.map(warningText).join(' ')
}

function warningKindOf(warnings: UpdateWarning[]): UpdateWarningKind | null {
  if (warnings.length === 0) return null
  return warnings.every(warning => warning.code === 'preview-unverified') ? 'notice' : 'failure'
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function compatibilityOf(version: string | null): ReleaseCompatibility {
  return version !== null && VERIFIED_DSH_VERSIONS.includes(version) ? 'verified' : 'unverified'
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

  getStatus(channel: ReleaseChannel = 'latest', cacheTtlMinutes?: number): Promise<UpdateStatus> {
    return this.check(false, channel, cacheTtlMinutes)
  }

  /** `force` bypasses TTL but still joins any registry check already in flight. */
  async check(force: boolean = false, channel: ReleaseChannel = 'latest', cacheTtlMinutes?: number): Promise<UpdateStatus> {
    const ttlMs = isCacheTtlMinutes(cacheTtlMinutes) ? cacheTtlMinutes * 60 * 1000 : this.ttlMs
    const cached = this.cache
    if (!force && cached !== undefined && this.now() - cached.checkedAtMs < ttlMs) {
      return this.statusFromCache(cached, channel, true, [])
    }
    if (this.inFlight !== undefined) {
      try {
        return this.statusFromCache(await this.inFlight, channel, false, [])
      } catch (error) {
        return this.statusAfterFailure(channel, error)
      }
    }

    const run = this.refreshRelease()
    this.inFlight = run
    try {
      return this.statusFromCache(await run, channel, false, [])
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
    const warnings: UpdateWarning[] = [{ code: 'registry-unavailable', detail: boundedMessage(error) }]
    return this.cache === undefined
      ? this.statusWithoutRemoteRelease(channel, warnings)
      : this.statusFromCache(this.cache, channel, true, warnings)
  }

  private statusFromCache(cache: CachedRelease, channel: ReleaseChannel, cached: boolean, initialWarnings: UpdateWarning[]): UpdateStatus {
    const selected = cache.release.channels.find(release => release.channel === channel)
      ?? { channel, version: null, publishedAt: null, compatibility: 'unverified' as const }
    const comparison = selected.version === null ? undefined : compareSemver(this.installation.currentVersion, selected.version)
    const warnings: UpdateWarning[] = [...initialWarnings]
    if (selected.version === null) warnings.push({ code: 'channel-unavailable', channel })
    if (selected.version !== null && comparison === undefined) {
      warnings.push({
        code: 'version-incomparable',
        currentVersion: this.installation.currentVersion,
        channel,
        selectedVersion: selected.version,
      })
    }
    if (channel !== 'latest' && selected.version !== null && selected.compatibility !== 'verified') {
      warnings.push({ code: 'preview-unverified', channel, version: selected.version })
    }
    return {
      currentVersion: this.installation.currentVersion,
      latestVersion: selected.version,
      hasUpdate: comparison !== undefined && comparison < 0,
      cached,
      checkedAt: new Date(cache.checkedAtMs).toISOString(),
      warning: warningFallback(warnings),
      warningKind: warningKindOf(warnings),
      warnings,
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

  private statusWithoutRemoteRelease(channel: ReleaseChannel, warnings: UpdateWarning[]): UpdateStatus {
    return {
      currentVersion: this.installation.currentVersion,
      latestVersion: null,
      hasUpdate: false,
      cached: false,
      checkedAt: null,
      warning: warningFallback(warnings),
      warningKind: warningKindOf(warnings),
      warnings,
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
