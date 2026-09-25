import { describe, expect, it } from 'vitest'
import { upgradeCommandFor, type InstallationInfo } from '../../src/host/installation.ts'
import { assertApprovedRegistryUrl, registryReleaseOf, UpdateStatusService, type RegistryRelease } from '../../src/host/update-status.ts'
import type { UpdateWarning } from '../../src/shared/types.ts'

const installation: InstallationInfo = {
  currentVersion: '0.1.2-rc.1',
  packageName: '@deepseek-ai/dsh',
  channel: 'latest',
  installKind: 'npm-global',
  upgradeCommand: 'npm install -g @deepseek-ai/dsh@latest',
}

function releases(latest = '0.1.2', alpha = '0.1.5-alpha.2'): RegistryRelease {
  return { channels: [
    { channel: 'latest', version: latest, publishedAt: '2026-01-02T03:04:05.000Z', compatibility: 'unverified' },
    { channel: 'next', version: latest, publishedAt: null, compatibility: 'unverified' },
    { channel: 'alpha', version: alpha, publishedAt: '2026-09-09T14:41:15.754Z', compatibility: 'unverified' },
  ] }
}

describe('UpdateStatusService', () => {
  it('caches one multi-channel check until TTL expires', async () => {
    let calls = 0
    let now = 10_000
    const service = new UpdateStatusService({
      installation,
      now: () => now,
      ttlMs: 100,
      fetchLatest: async () => { calls += 1; return releases() },
    })

    const first = await service.getStatus()
    const second = await service.getStatus('alpha')
    expect(calls).toBe(1)
    expect(first.cached).toBe(false)
    expect(first.latestVersion).toBe('0.1.2')
    expect(second.cached).toBe(true)
    expect(second.latestVersion).toBe('0.1.5-alpha.2')
    expect(second.channel).toBe('alpha')
    expect(second.upgradeCommand).toBe('npm install -g @deepseek-ai/dsh@alpha')
    expect(second.warning).toBe('alpha is a preview channel; version 0.1.5-alpha.2 has not been verified as compatible with this plugin.')
    // An unverified preview is an ADVISORY: the status is complete and usable, so the
    // chip must not be repainted for it. Regression: alpha.2 made the whole chip red.
    expect(second.warningKind).toBe('notice')
    expect(second.warnings).toEqual([
      { code: 'preview-unverified', channel: 'alpha', version: '0.1.5-alpha.2' },
    ])
    expect(second.channels).toHaveLength(3)

    now += 101
    await service.getStatus()
    expect(calls).toBe(2)
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
    await service.getStatus('latest', 30)
    now += 29 * 60 * 1000
    await service.getStatus('latest', 30)
    expect(calls).toBe(1)
    now += 2 * 60 * 1000
    await service.getStatus('latest', 30)
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

    const one = service.check(true, 'latest')
    const two = service.check(true, 'alpha')
    expect(calls).toBe(1)
    release()
    const [first, second] = await Promise.all([one, two])
    expect(first.latestVersion).toBe('0.1.2')
    expect(second.latestVersion).toBe('0.1.5-alpha.2')
    await service.check(true)
    expect(calls).toBe(2)
  })

  it('falls back to cached channel data with a warning if refresh fails', async () => {
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
    const status = await service.check(true, 'alpha')
    expect(status.cached).toBe(true)
    expect(status.latestVersion).toBe('0.1.5-alpha.2')
    expect(status.warning).toContain('Unable to check the npm registry: offline')
    expect(status.warning).toContain('alpha is a preview channel')
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([
      { code: 'registry-unavailable', detail: 'offline' },
      { code: 'preview-unverified', channel: 'alpha', version: '0.1.5-alpha.2' },
    ])
  })

  it('keeps a cold failure renderable for the selected channel', async () => {
    const service = new UpdateStatusService({
      installation,
      fetchLatest: async () => { throw new Error('network unavailable') },
    })
    const status = await service.getStatus('alpha')
    expect(status.currentVersion).toBe('0.1.2-rc.1')
    expect(status.latestVersion).toBeNull()
    expect(status.channel).toBe('alpha')
    expect(status.upgradeCommand).toContain('@alpha')
    expect(status.hasUpdate).toBe(false)
    expect(status.canApplyInPlace).toBe(false)
    expect(status.warning).toBe('Unable to check the npm registry: network unavailable')
    expect(status.warningKind).toBe('failure')
    expect(status.warnings).toEqual([
      { code: 'registry-unavailable', detail: 'network unavailable' },
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
    expect(status.warnings).toEqual([stale])
    // A degraded settings form is advisory: the version answer is complete and
    // usable, so the chip must not repaint for it.
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

  it('parses supported npm dist-tags from one registry document', () => {
    const release = registryReleaseOf({
      'dist-tags': { latest: '0.1.7-rc.1', next: '0.1.8-rc.1', alpha: '0.1.7-alpha.2', beta: '9.9.9' },
      time: { '0.1.7-rc.1': '2026-09-23T14:41:15.754Z' },
    })
    expect(release.channels.map(item => [item.channel, item.version])).toEqual([
      ['latest', '0.1.7-rc.1'], ['next', '0.1.8-rc.1'], ['alpha', '0.1.7-alpha.2'],
    ])
    // Only releases this bundle was actually verified against are labelled
    // verified; an untested release stays unverified.
    expect(release.channels[0]?.compatibility).toBe('verified')
    expect(release.channels[1]?.compatibility).toBe('unverified')
    expect(release.channels[2]?.compatibility).toBe('verified')
  })
})

describe('safety and command wording', () => {
  it('allows only the documented HTTPS npm authority', () => {
    expect(assertApprovedRegistryUrl('https://registry.npmjs.org/@deepseek-ai%2Fdsh').hostname).toBe('registry.npmjs.org')
    expect(() => assertApprovedRegistryUrl('http://registry.npmjs.org/a')).toThrow(/whitelisted/)
    expect(() => assertApprovedRegistryUrl('https://registry.npmjs.org.evil.example/a')).toThrow(/whitelisted/)
  })

  it('generates channel guidance but never execution behavior', () => {
    expect(upgradeCommandFor('npm-global')).toBe('npm install -g @deepseek-ai/dsh@latest')
    expect(upgradeCommandFor('npm-global', '@deepseek-ai/dsh', 'alpha')).toBe('npm install -g @deepseek-ai/dsh@alpha')
    expect(upgradeCommandFor('pnpm-global', '@deepseek-ai/dsh', 'next')).toBe('pnpm add -g @deepseek-ai/dsh@next')
    expect(upgradeCommandFor('source-checkout')).toBe('Update the DSH source checkout, install its dependencies, and rebuild it; this plugin cannot replace it in place from the GUI')
    expect(upgradeCommandFor('unknown')).toBe('Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you')
  })
})
