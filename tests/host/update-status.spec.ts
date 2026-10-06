import { describe, expect, it } from 'vitest'
import { upgradeCommandFor, type InstallationInfo } from '../../src/host/installation.ts'
import { assertApprovedRegistryUrl, registryReleaseOf, UpdateStatusService, type RegistryRelease } from '../../src/host/update-status.ts'
import type { UpdateWarning } from '../../src/shared/types.ts'

const installation: InstallationInfo = {
  currentVersion: '0.1.2-rc.1',
  packageName: '@deepseek-ai/dsh',
  installKind: 'npm-global',
}

function releases(version = '0.3.0-alpha.1'): RegistryRelease {
  return { latest: { version, publishedAt: '2026-09-09T14:41:15.754Z', compatibility: 'unverified' } }
}

describe('UpdateStatusService', () => {
  it('caches one registry read until the TTL expires', async () => {
    let calls = 0
    let now = 10_000
    const service = new UpdateStatusService({
      installation,
      now: () => now,
      ttlMs: 100,
      fetchLatest: async () => { calls += 1; return releases() },
    })

    const first = await service.getStatus()
    const second = await service.getStatus()
    expect(calls).toBe(1)
    expect(first.cached).toBe(false)
    expect(first.latestVersion).toBe('0.3.0-alpha.1')
    expect(second.cached).toBe(true)
    expect(second.hasUpdate).toBe(true)
    expect(second.upgradeCommand).toBe('npm install -g @deepseek-ai/dsh@0.3.0-alpha.1')
    expect(second.warning).toBe('Version 0.3.0-alpha.1 is newer than this plugin has been verified against.')
    // An unverified newer release is an ADVISORY: the status is complete and
    // usable, so the chip must not be repainted for it.
    expect(second.warningKind).toBe('notice')
    expect(second.warnings).toEqual([{ code: 'version-unverified', version: '0.3.0-alpha.1' }])
    expect(second.compatibility).toBe('unverified')

    now += 101
    await service.getStatus()
    expect(calls).toBe(2)
  })

  it('reports the newest tagged release as a plain update when it is verified', async () => {
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => ({ latest: { version: '0.1.7-rc.2', publishedAt: null, compatibility: 'verified' } }),
    })
    const status = await service.getStatus()
    expect(status.hasUpdate).toBe(true)
    expect(status.compatibility).toBe('verified')
    expect(status.warning).toBeNull()
    expect(status.warningKind).toBeNull()
    expect(status.warnings).toEqual([])
  })

  it('says nothing when the running release is the newest one', async () => {
    const service = new UpdateStatusService({
      installation: { ...installation, currentVersion: '0.3.0-alpha.1' },
      fetchLatest: async () => releases(),
    })
    const status = await service.getStatus()
    expect(status.hasUpdate).toBe(false)
    // Running an unverified (but newest) release is not an advisory: the plugin
    // is not recommending anything, so there is nothing to warn about.
    expect(status.warnings).toEqual([])
    expect(status.warningKind).toBeNull()
    expect(status.upgradeCommand).toBe('npm install -g @deepseek-ai/dsh@0.3.0-alpha.1')
  })

  it('uses the user-selected cache duration for ordinary reads without creating a timer', async () => {
    let calls = 0
    let now = 10_000
    const service = new UpdateStatusService({
      installation,
      now: () => now,
      ttlMs: 6 * 60 * 60 * 1000,
      fetchLatest: async () => { calls += 1; return releases() },
    })
    await service.getStatus(30)
    now += 29 * 60 * 1000
    await service.getStatus(30)
    expect(calls).toBe(1)
    now += 2 * 60 * 1000
    await service.getStatus(30)
    expect(calls).toBe(2)
  })

  it('force bypasses TTL and concurrent callers share one registry request', async () => {
    let calls = 0
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => { calls += 1; await waiting; return releases() },
    })

    const one = service.check(true)
    const two = service.check(true)
    expect(calls).toBe(1)
    release()
    const [first, second] = await Promise.all([one, two])
    expect(first.latestVersion).toBe('0.3.0-alpha.1')
    expect(second.latestVersion).toBe('0.3.0-alpha.1')
    await service.check(true)
    expect(calls).toBe(2)
  })

  it('falls back to the cached release with a warning if refresh fails', async () => {
    let shouldFail = false
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => {
        if (shouldFail) throw new Error('offline')
        return releases()
      },
    })

    await service.getStatus()
    shouldFail = true
    const status = await service.check(true)
    expect(status.cached).toBe(true)
    expect(status.latestVersion).toBe('0.3.0-alpha.1')
    expect(status.warning).toContain('Unable to check the npm registry: offline')
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([
      { code: 'registry-unavailable', detail: 'offline' },
      { code: 'version-unverified', version: '0.3.0-alpha.1' },
    ])
  })

  it('keeps a cold failure renderable', async () => {
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => { throw new Error('network unavailable') },
    })
    const status = await service.getStatus()
    expect(status.currentVersion).toBe('0.1.2-rc.1')
    expect(status.latestVersion).toBeNull()
    expect(status.hasUpdate).toBe(false)
    expect(status.upgradeCommand).toBe('npm install -g @deepseek-ai/dsh')
    expect(status.canApplyInPlace).toBe(false)
    expect(status.warning).toBe('Unable to check the npm registry: network unavailable')
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([
      { code: 'registry-unavailable', detail: 'network unavailable' },
    ])
  })

  it('reports an incomparable published version as a failure, not an update', async () => {
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => ({ latest: { version: 'not-a-version', publishedAt: null, compatibility: 'unverified' } }),
    })
    const status = await service.getStatus()
    expect(status.hasUpdate).toBe(false)
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([
      { code: 'version-incomparable', currentVersion: '0.1.2-rc.1', latestVersion: 'not-a-version' },
    ])
  })

  it('appends the process runtime warnings to every status as advisory', async () => {
    const stale: UpdateWarning = {
      code: 'stale-schemastery',
      version: '3.18.2',
      path: '/tmp/stale/node_modules/@deepseek-ai/schemastery/lib/index.cjs',
      nodeModulesDir: '/tmp/stale/node_modules',
    }
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => releases(),
      runtimeWarnings: [stale],
    })
    const status = await service.getStatus()
    // The registry advisory leads, the runtime one follows, severity stays advisory.
    expect(status.warnings).toEqual([{ code: 'version-unverified', version: '0.3.0-alpha.1' }, stale])
    expect(status.warningKind).toBe('notice')
    expect(status.warning).toContain('rm -rf /tmp/stale/node_modules')

    const offline = new UpdateStatusService({
      installation,
      fetchLatest: async () => { throw new Error('offline') },
      runtimeWarnings: [stale],
    })
    const cold = await offline.getStatus()
    // The registry failure still leads, and still decides the severity.
    expect(cold.warnings).toEqual([{ code: 'registry-unavailable', detail: 'offline' }, stale])
    expect(cold.warningKind).toBe('failure')
  })

  it('reduces every dist-tag to the single newest release', () => {
    const release = registryReleaseOf({
      'dist-tags': { latest: '0.2.0-rc.2', next: '0.2.0-rc.2', alpha: '0.2.1-alpha.1', beta: '0.2.0-beta.3' },
      time: { '0.2.1-alpha.1': '2026-09-29T09:56:00.000Z' },
    })
    // 0.2.1-alpha.1 is on this bundle's verified list, so it is labelled verified;
    // the alpha tag outranks the stable one because it carries a higher version.
    expect(release.latest).toEqual({
      version: '0.2.1-alpha.1',
      publishedAt: '2026-09-29T09:56:00.000Z',
      compatibility: 'verified',
    })
    // Only releases this bundle was actually verified against are labelled
    // verified; an untested release stays unverified.
    expect(registryReleaseOf({ 'dist-tags': { latest: '0.1.7-rc.2' } }).latest?.compatibility).toBe('verified')
    expect(registryReleaseOf({ 'dist-tags': { latest: 'v0.2.1-alpha.1' } }).latest?.version).toBe('v0.2.1-alpha.1')
  })

  it('skips an unparsable tag but keeps the release line behind it', () => {
    expect(registryReleaseOf({ 'dist-tags': { latest: 'nightly', alpha: '0.2.1-alpha.1' } }).latest?.version).toBe('0.2.1-alpha.1')
  })

  it('refuses a document with no comparable dist-tag or no dist-tags at all', () => {
    expect(() => registryReleaseOf({ 'dist-tags': { latest: 'not-a-version' } })).toThrow(/no comparable dist-tags/)
    expect(() => registryReleaseOf({})).toThrow(/no dist-tags/)
    expect(() => registryReleaseOf(null)).toThrow(/invalid document/)
  })
})

describe('safety and command wording', () => {
  it('allows only the documented HTTPS npm authority', () => {
    expect(assertApprovedRegistryUrl('https://registry.npmjs.org/@deepseek-ai%2Fdsh').hostname).toBe('registry.npmjs.org')
    expect(() => assertApprovedRegistryUrl('http://registry.npmjs.org/a')).toThrow(/whitelisted/)
    expect(() => assertApprovedRegistryUrl('https://registry.npmjs.org.evil.example/a')).toThrow(/whitelisted/)
  })

  it('names the exact version and never execution behavior', () => {
    // A pinned version cannot be re-pointed between the check and the terminal,
    // which a dist-tag can — the reason the command is no longer `@latest`.
    expect(upgradeCommandFor('npm-global', '@deepseek-ai/dsh', '0.2.1-alpha.1')).toBe('npm install -g @deepseek-ai/dsh@0.2.1-alpha.1')
    expect(upgradeCommandFor('pnpm-global', '@deepseek-ai/dsh', '0.1.7-rc.2')).toBe('pnpm add -g @deepseek-ai/dsh@0.1.7-rc.2')
    expect(upgradeCommandFor('npm-global')).toBe('npm install -g @deepseek-ai/dsh')
    expect(upgradeCommandFor('source-checkout', '@deepseek-ai/dsh', '0.2.1-alpha.1')).toBe('Update the DSH source checkout, install its dependencies, and rebuild it; this plugin cannot replace it in place from the GUI')
    expect(upgradeCommandFor('unknown', '@deepseek-ai/dsh', '0.2.1-alpha.1')).toBe('Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you')
  })
})
