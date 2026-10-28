/**
 * Read-only npm-registry update checker with process-local TTL cache and
 * single-flight coordination.
 *
 * The plugin's whole purpose is to tell an operator that a newer DSH release
 * exists and how to get it, so this read keeps EVERY version any dist-tag
 * publishes, then reports the ones strictly newer than the running version,
 * newest first. `latest`, `next` and `alpha` are npm bookkeeping, not a user
 * choice: a version published under a tag this plugin has never heard of still
 * counts. Compatibility is deliberately not judged here — whether DSH can load
 * this plugin is decided by its own engine and peer ranges.
 */

import type { InstallationInfo } from './installation.ts'
import { upgradeCommandFor } from './installation.ts'
import { SCHEMASTERY_NAME } from './schemastery.ts'
import { compareSemver, parseSemver } from '../shared/semver.ts'
import {
  PACKAGE_NAME,
  RELEASES_URL,
  DEFAULT_CACHE_TTL_MINUTES,
  isCacheTtlMinutes,
  type ReleaseCandidate,
  type UpdateStatus,
  type UpdateWarning,
  type UpdateWarningKind,
} from '../shared/types.ts'

export const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
export const DEFAULT_TTL_MS = DEFAULT_CACHE_TTL_MINUTES * 60 * 1000
export const DEFAULT_TIMEOUT_MS = 15_000

/** One tagged version from the registry, before it is compared with the running version. */
export interface RegistryCandidate {
  version: string
  tag: string | null
  publishedAt: string | null
}

/** Every version the registry publishes under a dist-tag, newest first. */
export interface RegistrySnapshot {
  releases: RegistryCandidate[]
}

export type RegistryFetcher = () => Promise<RegistrySnapshot>

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

interface CachedReleases {
  releases: RegistryCandidate[]
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
const ADVISORY_CODES: readonly UpdateWarning['code'][] = ['stale-schemastery']

function warningKindOf(warnings: UpdateWarning[]): UpdateWarningKind | null {
  if (warnings.length === 0) return null
  return warnings.every(warning => ADVISORY_CODES.includes(warning.code)) ? 'notice' : 'failure'
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** The numeric release line of a version: `0.2.1-rc.4` belongs to line `0.2.1`. */
export function releaseLineOf(version: string): string {
  return version.split('-', 1)[0] ?? version
}

/** Tag preference when two tags point at the same version; npm's own vocabulary leads. */
const TAG_PRIORITY: readonly string[] = ['latest', 'next', 'alpha', 'beta', 'rc']

function preferredTag(left: string, right: string): string {
  const rank = (tag: string): number => {
    const index = TAG_PRIORITY.indexOf(tag)
    return index === -1 ? TAG_PRIORITY.length : index
  }
  return rank(left) <= rank(right) ? left : right
}

/**
 * Reduce one registry document to every tagged version, newest first.
 *
 * Every dist-tag contributes, not a fixed `latest`/`next`/`alpha` triple: npm
 * tags are the registry's own vocabulary, and a version published under a tag
 * this plugin has never heard of is still a version users can install. A version
 * carried by several tags keeps the most specific tag name (latest > next >
 * alpha > …), and an unparsable version is dropped rather than rendered as a
 * card nobody can compare.
 */
export function registryReleasesOf(value: unknown): RegistrySnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('npm registry returned an invalid document')
  const record = value as Record<string, unknown>
  const tags = record['dist-tags']
  if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) throw new Error('npm registry response has no dist-tags')
  const time = record.time
  const timeRecord = time !== null && typeof time === 'object' && !Array.isArray(time)
    ? time as Record<string, unknown>
    : {}

  /** version -> tag, keeping one deterministic tag per version. */
  const byVersion = new Map<string, string>()
  for (const [tag, raw] of Object.entries(tags as Record<string, unknown>)) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const version = raw.trim()
    const existing = byVersion.get(version)
    byVersion.set(version, existing === undefined ? tag : preferredTag(existing, tag))
  }

  const releases: RegistryCandidate[] = []
  for (const [version, tag] of byVersion) {
    if (parseSemver(version) === undefined) continue
    releases.push({ version, tag, publishedAt: dateOrNull(timeRecord[version]) })
  }
  releases.sort((left, right) => (compareSemver(right.version, left.version) ?? 0))
  if (releases.length === 0) throw new Error('npm registry response has no comparable dist-tags')
  return { releases }
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
        // complete JSON document is required to display publish dates.
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
      return registryReleasesOf(await response.json())
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`npm registry timed out after ${boundedTimeout}ms`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * A copyable command is only honest for a package-manager installation; a source
 * checkout and an unknown installation get guidance text instead of a command
 * that would not work.
 */
function copyableCommand(installation: InstallationInfo, version: string): string | null {
  if (installation.installKind !== 'npm-global' && installation.installKind !== 'pnpm-global') return null
  return upgradeCommandFor(installation.installKind, installation.packageName || PACKAGE_NAME, version)
}

export class UpdateStatusService {
  private readonly installation: InstallationInfo
  private readonly fetchLatest: RegistryFetcher
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly releaseUrl: string
  private readonly runtimeWarnings: readonly UpdateWarning[]
  private cache: CachedReleases | undefined
  private inFlight: Promise<CachedReleases> | undefined

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

    const run = this.refreshReleases()
    this.inFlight = run
    try {
      return this.statusFromCache(await run, false, [])
    } catch (error) {
      return this.statusAfterFailure(error)
    } finally {
      if (this.inFlight === run) this.inFlight = undefined
    }
  }

  private async refreshReleases(): Promise<CachedReleases> {
    const cache = { releases: (await this.fetchLatest()).releases, checkedAtMs: this.now() }
    this.cache = cache
    return cache
  }

  private statusAfterFailure(error: unknown): UpdateStatus {
    const warnings: UpdateWarning[] = [{ code: 'registry-unavailable', detail: boundedMessage(error) }]
    return this.cache === undefined
      ? this.statusWithoutRemoteRelease(warnings)
      : this.statusFromCache(this.cache, true, warnings)
  }

  private statusFromCache(cache: CachedReleases, cached: boolean, initialWarnings: UpdateWarning[]): UpdateStatus {
    const current = this.installation.currentVersion
    const warnings: UpdateWarning[] = [...initialWarnings]
    const releases: ReleaseCandidate[] = []

    if (parseSemver(current) === undefined) {
      // The running version is not SemVer, so no candidate can be ordered
      // against it. Say so once instead of rendering arbitrary cards.
      const newest = cache.releases[0]
      if (newest !== undefined) {
        warnings.push({ code: 'version-incomparable', currentVersion: current, latestVersion: newest.version })
      }
    } else {
      for (const candidate of cache.releases) {
        const comparison = compareSemver(current, candidate.version)
        // Strictly newer only: an equal version is what is already running, and
        // an older one is a downgrade the operator did not ask about.
        if (comparison === undefined || comparison >= 0) continue
        releases.push({
          version: candidate.version,
          tag: candidate.tag,
          publishedAt: candidate.publishedAt,
          line: releaseLineOf(candidate.version),
          command: copyableCommand(this.installation, candidate.version),
        })
      }
      // The contract promises highest-first whatever the registry (or a test
      // double) hands over; the card highlight depends on that order.
      releases.sort((left, right) => (compareSemver(right.version, left.version) ?? 0))
    }

    warnings.push(...this.runtimeWarnings)
    return {
      currentVersion: current,
      releases,
      hasUpdate: releases.length > 0,
      cached,
      checkedAt: new Date(cache.checkedAtMs).toISOString(),
      warning: warningFallback(warnings),
      warningKind: warningKindOf(warnings),
      warnings,
      installKind: this.installation.installKind,
      releaseUrl: this.releaseUrl,
      changelogUrl: this.releaseUrl,
      packageName: this.installation.packageName || PACKAGE_NAME,
      canApplyInPlace: false,
    }
  }

  private statusWithoutRemoteRelease(warnings: UpdateWarning[]): UpdateStatus {
    const combined = [...warnings, ...this.runtimeWarnings]
    return {
      currentVersion: this.installation.currentVersion,
      releases: [],
      hasUpdate: false,
      cached: false,
      checkedAt: null,
      warning: warningFallback(combined),
      warningKind: warningKindOf(combined),
      warnings: combined,
      installKind: this.installation.installKind,
      releaseUrl: this.releaseUrl,
      changelogUrl: this.releaseUrl,
      packageName: this.installation.packageName || PACKAGE_NAME,
      canApplyInPlace: false,
    }
  }
}
