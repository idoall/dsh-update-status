import { describe, expect, it } from 'vitest'
import { upgradeCommandFor, type InstallationInfo } from '../../src/host/installation.ts'
import { assertApprovedRegistryUrl, registryReleaseOf, UpdateStatusService, type RegistryRelease } from '../../src/host/update-status.ts'

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
    expect(second.warning).toContain('尚未验证')
    expect(second.channels).toHaveLength(3)

    now += 101
    await service.getStatus()
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
    expect(status.warning).toContain('offline')
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
    expect(status.warning).toContain('network unavailable')
  })

  it('parses supported npm dist-tags from one registry document', () => {
    const release = registryReleaseOf({
      'dist-tags': { latest: '0.1.2-rc.1', next: '0.1.2-rc.1', alpha: '0.1.5-alpha.2', beta: '9.9.9' },
      time: { '0.1.5-alpha.2': '2026-09-09T14:41:15.754Z' },
    })
    expect(release.channels.map(item => [item.channel, item.version])).toEqual([
      ['latest', '0.1.2-rc.1'], ['next', '0.1.2-rc.1'], ['alpha', '0.1.5-alpha.2'],
    ])
    expect(release.channels[0]?.compatibility).toBe('verified')
    expect(release.channels[2]?.compatibility).toBe('unverified')
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
    expect(upgradeCommandFor('source-checkout')).toContain('checkout')
    expect(upgradeCommandFor('unknown')).toContain('不会代为执行')
  })
})
