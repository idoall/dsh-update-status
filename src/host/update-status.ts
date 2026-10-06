/**
 * Read-only npm-registry update checker with process-local TTL cache and
 * single-flight coordination.
 *
 * ONE release line, not a channel catalogue: the registry read keeps only the
 * newest version published under any dist-tag, so the whole plugin has a single
 * answer to render and a single version to name in the upgrade command. Whether
 * that newest release is stable, a release candidate or an alpha is npm's
 * bookkeeping — a newer release is a newer release, and it is reported.
 */

import type { InstallationInfo } from './installation.ts'
import { upgradeCommandFor } from './installation.ts'
import { SCHEMASTERY_NAME } from './schemastery.ts'
import { compareSemver, newestSemver } from '../shared/semver.ts'
import {
  PACKAGE_NAME,
  RELEASES_URL,
  DEFAULT_CACHE_TTL_MINUTES,
  isCacheTtlMinutes,
  VERIFIED_DSH_VERSIONS,
  type ReleaseCompatibility,
  type UpdateStatus,
  type UpdateWarning,
  type UpdateWarningKind,
} from '../shared/types.ts'

export const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
export const DEFAULT_TTL_MS = DEFAULT_CACHE_TTL_MINUTES * 60 * 1000
export const DEFAULT_TIMEOUT_MS = 15_000

/** The newest release the registry publishes, with everything the UI shows. */
export interface RegistryLatest {
  version: string
  publishedAt: string | null
  compatibility: ReleaseCompatibility
}

export interface RegistryRelease {
  latest: RegistryLatest | null
}

export type RegistryFetcher = () => Promise<RegistryRelease>

export interface UpdateStatusServiceOptions {
  installation: InstallationInfo
  fetchLatest?: RegistryFetcher
  now?: () => number
  ttlMs?: number
  releaseUrl?: string
  /**
   * Facts about this process's own runtime, appended to every status. The schema
   * resolution is the only producer today; the registry read never sets these.
   */
  runtimeWarnings?: readonly UpdateWarning[]
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

/** English, single-line rendering of one warning; the Host log uses it directly. */
export function describeWarning(warning: UpdateWarning): string {
  switch (warning.code) {
    case 'registry-unavailable': return `Unable to check the npm registry: ${warning.detail}`
    case 'version-incomparable': return `Unable to compare the current version ${warning.currentVersion} with the published version ${warning.latestVersion} using SemVer.`
    case 'version-unverified': return `Version ${warning.version} is newer than this plugin has been verified against.`
    case 'stale-schemastery': {
      const version = warning.version === null ? '' : ` ${warning.version}`
      // Only name a removal command when the directory is known; `rm -rf` on the
      // module path would delete one file out of the stale package.
      const remedy = warning.nodeModulesDir === null
        ? `Remove the stale ${SCHEMASTERY_NAME} directory there and restart DSH.`
        : `Remove the stale copy and restart DSH: rm -rf ${warning.nodeModulesDir}`
      return `This plugin resolved ${SCHEMASTERY_NAME}${version} from ${warning.path} instead of the copy DSH provides, so preference fields cannot be marked volatile. ${remedy}`
    }
  }
}

function warningFallback(warnings: UpdateWarning[]): string | null {
  return warnings.length === 0 ? null : warnings.map(describeWarning).join(' ')
}

/**
 * Advisory codes leave the chip alone; everything else is a failed read.
 *
 * `stale-schemastery` belongs here: the version answer is complete and usable,
 * and only the settings form is degraded, so repainting the brand row would
 * misreport a plugin-runtime fact as a failed update check.
 */
const ADVISORY_CODES: readonly UpdateWarning['code'][] = ['version-unverified', 'stale-schemastery']

function warningKindOf(warnings: UpdateWarning[]): UpdateWarningKind | null {
  if (warnings.length === 0) return null
  return warnings.every(warning => ADVISORY_CODES.includes(warning.code)) ? 'notice' : 'failure'
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function compatibilityOf(version: string): ReleaseCompatibility {
  return VERIFIED_DSH_VERSIONS.includes(version) ? 'verified' : 'unverified'
}

/**
 * Reduce one registry document to the single newest release.
 *
 * Every dist-tag contributes, not a fixed `latest`/`next`/`alpha` triple: npm
 * tags are the registry's own vocabulary, and a version published under a tag
 * this plugin has never heard of is still a version users can install.
 */
export function registryReleaseOf(value: unknown): RegistryRelease {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('npm registry returned an invalid document')
  const record = value as Record<string, unknown>
  const tags = record['dist-tags']
  if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) throw new Error('npm registry response has no dist-tags')
  const tagged = Object.values(tags as Record<string, unknown>)
    .filter((version): version is string => typeof version === 'string' && version.trim() !== '')
    .map(version => version.trim())
  const version = newestSemver(tagged)
  if (version === undefined) throw new Error('npm registry response has no comparable dist-tags')
  const time = record.time
  const timeRecord = time !== null && typeof time === 'object' && !Array.isArray(time)
    ? time as Record<string, unknown>
    : {}
  return { latest: { version, publishedAt: dateOrNull(timeRecord[version]), compatibility: compatibilityOf(version) } }
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
        // complete JSON document is required to display the publish date.
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
  private readonly runtimeWarnings: readonly UpdateWarning[]
  private cache: CachedRelease | undefined
  private inFlight: Promise<CachedRelease> | undefined

  constructor(options: UpdateStatusServiceOptions) {
    this.installation = options.installation
    this.fetchLatest = options.fetchLatest ?? createRegistryFetcher()
    this.now = options.now ?? Date.now
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS))
    this.releaseUrl = options.releaseUrl ?? RELEASES_URL
    this.runtimeWarnings = options.runtimeWarnings ?? []
  }

  getStatus(cacheTtlMinutes?: number): Promise<UpdateStatus> {
    return this.check(false, cacheTtlMinutes)
  }

  /** `force` bypasses TTL but still joins any registry check already in flight. */
  async check(force: boolean = false, cacheTtlMinutes?: number): Promise<UpdateStatus> {
    const ttlMs = isCacheTtlMinutes(cacheTtlMinutes) ? cacheTtlMinutes * 60 * 1000 : this.ttlMs
    const cached = this.cache
    if (!force && cached !== undefined && this.now() - cached.checkedAtMs < ttlMs) {
      return this.statusFromCache(cached, true, [])
    }
    if (this.inFlight !== undefined) {
      try {
        return this.statusFromCache(await this.inFlight, false, [])
      } catch (error) {
        return this.statusAfterFailure(error)
      }
    }

    const run = this.refreshRelease()
    this.inFlight = run
    try {
      return this.statusFromCache(await run, false, [])
    } catch (error) {
      return this.statusAfterFailure(error)
    } finally {
      if (this.inFlight === run) this.inFlight = undefined
    }
  }

  private async refreshRelease(): Promise<CachedRelease> {
    const cache = { release: await this.fetchLatest(), checkedAtMs: this.now() }
    this.cache = cache
    return cache
  }

  private statusAfterFailure(error: unknown): UpdateStatus {
    const warnings: UpdateWarning[] = [{ code: 'registry-unavailable', detail: boundedMessage(error) }]
    return this.cache === undefined
      ? this.statusWithoutRemoteRelease(warnings)
      : this.statusFromCache(this.cache, true, warnings)
  }

  private statusFromCache(cache: CachedRelease, cached: boolean, initialWarnings: UpdateWarning[]): UpdateStatus {
    const selected = cache.release.latest
    const comparison = selected === null ? undefined : compareSemver(this.installation.currentVersion, selected.version)
    const hasUpdate = comparison !== undefined && comparison < 0
    const warnings: UpdateWarning[] = [...initialWarnings]
    if (selected !== null && comparison === undefined) {
      warnings.push({
        code: 'version-incomparable',
        currentVersion: this.installation.currentVersion,
        latestVersion: selected.version,
      })
    }
    // Only a version this plugin is RECOMMENDING is worth an advisory: when the
    // running release is simply ahead of the verified list, saying so would be
    // noise about a choice the operator already made.
    if (hasUpdate && selected !== null && selected.compatibility !== 'verified') {
      warnings.push({ code: 'version-unverified', version: selected.version })
    }
    warnings.push(...this.runtimeWarnings)
    return {
      currentVersion: this.installation.currentVersion,
      latestVersion: selected?.version ?? null,
      hasUpdate,
      compatibility: selected?.compatibility ?? 'unverified',
      cached,
      checkedAt: new Date(cache.checkedAtMs).toISOString(),
      warning: warningFallback(warnings),
      warningKind: warningKindOf(warnings),
      warnings,
      installKind: this.installation.installKind,
      upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || PACKAGE_NAME, selected?.version ?? null),
      releaseUrl: this.releaseUrl,
      changelogUrl: this.releaseUrl,
      publishedAt: selected?.publishedAt ?? null,
      packageName: this.installation.packageName || PACKAGE_NAME,
      canApplyInPlace: false,
    }
  }

  private statusWithoutRemoteRelease(warnings: UpdateWarning[]): UpdateStatus {
    const combined = [...warnings, ...this.runtimeWarnings]
    return {
      currentVersion: this.installation.currentVersion,
      latestVersion: null,
      hasUpdate: false,
      compatibility: 'unverified',
      cached: false,
      checkedAt: null,
      warning: warningFallback(combined),
      warningKind: warningKindOf(combined),
      warnings: combined,
      installKind: this.installation.installKind,
      upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || PACKAGE_NAME, null),
      releaseUrl: this.releaseUrl,
      changelogUrl: this.releaseUrl,
      publishedAt: null,
      packageName: this.installation.packageName || PACKAGE_NAME,
      canApplyInPlace: false,
    }
  }
}
