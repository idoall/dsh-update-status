import { describe, expect, it } from 'vitest'
import { upgradeCommandFor, type InstallationInfo } from '../../src/host/installation.ts'
import { assertApprovedRegistryUrl, registryReleasesOf, UpdateStatusService, type RegistrySnapshot } from '../../src/host/update-status.ts'
import type { UpdateWarning } from '../../src/shared/types.ts'

const installation: InstallationInfo = {
  currentVersion: '0.1.2-rc.1',
  packageName: '@deepseek-ai/dsh',
  installKind: 'npm-global',
}

function snapshot(...versions: Array<[string, string | null]>): RegistrySnapshot {
  return {
    releases: versions.map(([version, tag]) => ({ version, tag, publishedAt: '2026-09-09T14:41:15.754Z' })),
  }
}

describe('UpdateStatusService', () => {
  it('caches one registry read until the TTL expires', async () => {
    let calls = 0
    let now = 10_000
    const service = new UpdateStatusService({
      installation,
      now: () => now,
      ttlMs: 100,
      fetchLatest: async () => { calls += 1; return snapshot(['0.3.0-alpha.1', 'alpha']) },
    })

    const first = await service.getStatus()
    const second = await service.getStatus()
    expect(calls).toBe(1)
    expect(first.cached).toBe(false)
    expect(first.releases.map(release => release.version)).toEqual(['0.3.0-alpha.1'])
    expect(second.cached).toBe(true)
    expect(second.hasUpdate).toBe(true)
    expect(second.releases[0]?.command).toBe('npm install -g @deepseek-ai/dsh@0.3.0-alpha.1')
    // A newer release is a plain answer, never an advisory about bookkeeping.
    expect(second.warning).toBeNull()
    expect(second.warningKind).toBeNull()
    expect(second.warnings).toEqual([])

    now += 101
    await service.getStatus()
    expect(calls).toBe(2)
  })

  it('reports every newer version, newest first, each with its own command', async () => {
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => snapshot(
        ['0.2.2-alpha.2', 'alpha'],
        ['0.3.0-rc.1', 'next'],
        ['0.1.7-rc.2', 'latest'],
      ),
    })
    const status = await service.getStatus()
    expect(status.releases.map(release => release.version)).toEqual(['0.3.0-rc.1', '0.2.2-alpha.2', '0.1.7-rc.2'])
    expect(status.releases.map(release => release.tag)).toEqual(['next', 'alpha', 'latest'])
    expect(status.releases.map(release => release.line)).toEqual(['0.3.0', '0.2.2', '0.1.7'])
    expect(status.releases.map(release => release.command)).toEqual([
      'npm install -g @deepseek-ai/dsh@0.3.0-rc.1',
      'npm install -g @deepseek-ai/dsh@0.2.2-alpha.2',
      'npm install -g @deepseek-ai/dsh@0.1.7-rc.2',
    ])
    expect(status.hasUpdate).toBe(true)
  })

  it('shows strictly newer versions only: equal and older versions produce no card', async () => {
    const service = new UpdateStatusService({
      installation: { ...installation, currentVersion: '0.2.1-rc.4' },
      fetchLatest: async () => snapshot(
        ['0.2.1-rc.4', 'next'],
        ['0.2.1-rc.2', 'latest'],
        ['0.2.2-alpha.2', 'alpha'],
      ),
    })
    const status = await service.getStatus()
    expect(status.releases.map(release => release.version)).toEqual(['0.2.2-alpha.2'])
    expect(status.hasUpdate).toBe(true)
  })

  it('has nothing to offer when the running release is the newest one', async () => {
    const service = new UpdateStatusService({
      installation: { ...installation, currentVersion: '0.3.0-alpha.1' },
      fetchLatest: async () => snapshot(['0.3.0-alpha.1', 'alpha']),
    })
    const status = await service.getStatus()
    expect(status.releases).toEqual([])
    expect(status.hasUpdate).toBe(false)
    expect(status.warning).toBeNull()
  })

  it('leaves the command empty when the installation cannot be upgraded by a copied command', async () => {
    const service = new UpdateStatusService({
      installation: { ...installation, installKind: 'source-checkout' },
      fetchLatest: async () => snapshot(['0.3.0-alpha.1', 'alpha']),
    })
    const status = await service.getStatus()
    expect(status.releases).toHaveLength(1)
    expect(status.releases[0]?.command).toBeNull()
  })

  it('uses the user-selected cache duration for ordinary reads without creating a timer', async () => {
    let calls = 0
    let now = 10_000
    const service = new UpdateStatusService({
      installation,
      now: () => now,
      ttlMs: 6 * 60 * 60 * 1000,
      fetchLatest: async () => { calls += 1; return snapshot(['0.3.0-alpha.1', 'alpha']) },
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
      fetchLatest: async () => { calls += 1; await waiting; return snapshot(['0.3.0-alpha.1', 'alpha']) },
    })

    const one = service.check(true)
    const two = service.check(true)
    expect(calls).toBe(1)
    release()
    const [first, second] = await Promise.all([one, two])
    expect(first.releases[0]?.version).toBe('0.3.0-alpha.1')
    expect(second.releases[0]?.version).toBe('0.3.0-alpha.1')
    await service.check(true)
    expect(calls).toBe(2)
  })

  it('falls back to the cached release with a warning if refresh fails', async () => {
    let shouldFail = false
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => {
        if (shouldFail) throw new Error('offline')
        return snapshot(['0.3.0-alpha.1', 'alpha'])
      },
    })

    await service.getStatus()
    shouldFail = true
    const status = await service.check(true)
    expect(status.cached).toBe(true)
    expect(status.releases.map(release => release.version)).toEqual(['0.3.0-alpha.1'])
    expect(status.warning).toContain('Unable to check the npm registry: offline')
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([{ code: 'registry-unavailable', detail: 'offline' }])
  })

  it('keeps a cold failure renderable', async () => {
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => { throw new Error('network unavailable') },
    })
    const status = await service.getStatus()
    expect(status.currentVersion).toBe('0.1.2-rc.1')
    expect(status.releases).toEqual([])
    expect(status.hasUpdate).toBe(false)
    expect(status.canApplyInPlace).toBe(false)
    expect(status.warning).toBe('Unable to check the npm registry: network unavailable')
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([
      { code: 'registry-unavailable', detail: 'network unavailable' },
    ])
  })

  it('reports an incomparable running version as a failure, not an update', async () => {
    const service = new UpdateStatusService({
      installation: { ...installation, currentVersion: 'not-a-version' },
      fetchLatest: async () => snapshot(['0.3.0-alpha.1', 'alpha']),
    })
    const status = await service.getStatus()
    expect(status.releases).toEqual([])
    expect(status.hasUpdate).toBe(false)
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([
      { code: 'version-incomparable', currentVersion: 'not-a-version', latestVersion: '0.3.0-alpha.1' },
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
      fetchLatest: async () => snapshot(['0.3.0-alpha.1', 'alpha']),
      runtimeWarnings: [stale],
    })
    const status = await service.getStatus()
    expect(status.warnings).toEqual([stale])
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

  it('keeps every tagged version, preferring the most specific tag per version', () => {
    const parsed = registryReleasesOf({
      'dist-tags': { latest: '0.2.0-rc.2', next: '0.2.0-rc.2', alpha: '0.2.1-alpha.1', beta: '0.2.0-beta.3' },
      time: { '0.2.1-alpha.1': '2026-09-29T09:56:00.000Z' },
    })
    expect(parsed.releases.map(release => release.version)).toEqual(['0.2.1-alpha.1', '0.2.0-rc.2', '0.2.0-beta.3'])
    // A version carried by two tags keeps the more authoritative name.
    expect(parsed.releases.find(release => release.version === '0.2.0-rc.2')?.tag).toBe('latest')
    expect(parsed.releases[0]?.publishedAt).toBe('2026-09-29T09:56:00.000Z')
    expect(parsed.releases[1]?.publishedAt).toBeNull()
  })

  it('counts an unknown tag and skips an unparsable version', () => {
    const parsed = registryReleasesOf({ 'dist-tags': { latest: 'nightly', alpha: '0.2.1-alpha.1', preview: '0.3.0-beta.1' } })
    expect(parsed.releases.map(release => release.version)).toEqual(['0.3.0-beta.1', '0.2.1-alpha.1'])
    expect(parsed.releases[0]?.tag).toBe('preview')
  })

  it('refuses a document with no comparable dist-tag or no dist-tags at all', () => {
    expect(() => registryReleasesOf({ 'dist-tags': { latest: 'not-a-version' } })).toThrow(/no comparable dist-tags/)
    expect(() => registryReleasesOf({})).toThrow(/no dist-tags/)
    expect(() => registryReleasesOf(null)).toThrow(/invalid document/)
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
    // which a dist-tag can — the reason the command is not `@latest`.
    expect(upgradeCommandFor('npm-global', '@deepseek-ai/dsh', '0.2.1-alpha.1')).toBe('npm install -g @deepseek-ai/dsh@0.2.1-alpha.1')
    expect(upgradeCommandFor('pnpm-global', '@deepseek-ai/dsh', '0.1.7-rc.2')).toBe('pnpm add -g @deepseek-ai/dsh@0.1.7-rc.2')
    expect(upgradeCommandFor('npm-global')).toBe('npm install -g @deepseek-ai/dsh')
    expect(upgradeCommandFor('source-checkout', '@deepseek-ai/dsh', '0.2.1-alpha.1')).toBe('Update the DSH source checkout, install its dependencies, and rebuild it; this plugin cannot replace it in place from the GUI')
    expect(upgradeCommandFor('unknown', '@deepseek-ai/dsh', '0.2.1-alpha.1')).toBe('Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you')
  })
})
