/** RPC status boundary specs. */
import { describe, expect, it } from 'vitest'
import { restartCheckOf, restartRequestOf, restartStatusOf, updateStatusOf } from '../../src/client/contract.ts'

function payload(overrides: Record<string, unknown> = {}, warnings: unknown = []): Record<string, unknown> {
  return {
    currentVersion: '0.2.0-rc.2', latestVersion: '0.2.1-alpha.1', hasUpdate: true,
    compatibility: 'unverified', cached: false, checkedAt: null, warning: null, warnings,
    installKind: 'npm-global', upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
    releaseUrl: 'https://example.test/releases', changelogUrl: 'https://example.test/releases',
    publishedAt: null, packageName: '@deepseek-ai/dsh', canApplyInPlace: false, ...overrides,
  }
}

const stale = { code: 'stale-schemastery', version: '3.18.2', path: '/p/node_modules/@deepseek-ai/schemastery/lib/index.cjs', nodeModulesDir: '/p/node_modules' }

describe('RPC status boundary', () => {
  it('accepts every structured warning the Host can produce', () => {
    const warnings = [stale, { code: 'registry-unavailable', detail: 'offline' }, { code: 'version-incomparable', currentVersion: '0.2.0-rc.2', latestVersion: 'nightly' }, { code: 'version-unverified', version: '0.2.1-alpha.1' }]
    expect(updateStatusOf(payload({}, warnings))?.warnings).toEqual(warnings)
  })

  it('accepts stale-schemastery with unreadable version and directory', () => {
    const unknown = { ...stale, version: null, nodeModulesDir: null }
    expect(updateStatusOf(payload({}, [unknown]))?.warnings).toEqual([unknown])
  })

  it('carries the newest release and compatibility through the guard', () => {
    const status = updateStatusOf(payload())
    expect(status?.latestVersion).toBe('0.2.1-alpha.1')
    expect(status?.hasUpdate).toBe(true)
    expect(status?.compatibility).toBe('unverified')
  })

  it('rejects missing/invalid release facts and malformed warnings', () => {
    expect(updateStatusOf(payload({ latestVersion: undefined }))).toBeUndefined()
    expect(updateStatusOf(payload({ compatibility: 'maybe' }))).toBeUndefined()
    expect(updateStatusOf(payload({}, [{ code: 'stale-schemastery', version: '3.18.2' }]))).toBeUndefined()
    expect(updateStatusOf(payload({}, [{ ...stale, path: 7 }]))).toBeUndefined()
    expect(updateStatusOf(payload({}, [{ code: 'something-else' }]))).toBeUndefined()
  })
})

describe('restart RPC boundary', () => {
  const supervised = { instanceId: 'new-host', startedAt: '2026-10-09T00:25:03.000Z', available: true, supervisor: 'launchd', unavailableReason: null }

  it('accepts a strict supervised status, activity check, and accepted response', () => {
    expect(restartStatusOf(supervised)).toEqual(supervised)
    expect(restartCheckOf({
      kind: 'active-work', status: supervised,
      activity: { hasActive: true, items: [{ type: 'job', id: 'job-1', label: 'Build', status: 'running', ownerSession: 's1' }] },
    })).toMatchObject({ kind: 'active-work' })
    expect(restartRequestOf({ kind: 'scheduled', instanceId: 'new-host' })).toEqual({ kind: 'scheduled', instanceId: 'new-host' })
  })

  it('keeps the Host start time, and tolerates a Host that predates it', () => {
    expect(restartStatusOf(supervised)?.startedAt).toBe('2026-10-09T00:25:03.000Z')
    // A hot-reloaded bundle can meet an older Host: the line is simply absent.
    const { startedAt, ...withoutStart } = supervised
    expect(restartStatusOf(withoutStart)).toEqual(withoutStart)
    void startedAt
    expect(restartStatusOf({ ...supervised, startedAt: 7 })).toBeUndefined()
    expect(restartStatusOf({ ...supervised, startedAt: '' })).toBeUndefined()
  })

  it('carries the copy-only recovery steps, and tolerates a Host without them', () => {
    const withRecovery = { ...supervised, available: false, unavailableReason: 'supervisor-mismatch', recovery: { commands: 'lsof -nP -iTCP:3080 -sTCP:LISTEN\nlaunchctl kickstart -k gui/501/x' } }
    expect(restartStatusOf(withRecovery)?.recovery?.commands).toContain('launchctl kickstart')
    expect(restartStatusOf(supervised)?.recovery).toBeUndefined()
    // A half-filled or foreign shape is not advice this panel will show.
    expect(restartStatusOf({ ...withRecovery, recovery: {} })).toBeUndefined()
    expect(restartStatusOf({ ...withRecovery, recovery: { commands: '' } })).toBeUndefined()
    expect(restartStatusOf({ ...withRecovery, recovery: { commands: 7 } })).toBeUndefined()
    expect(restartStatusOf({ ...withRecovery, recovery: 'rm -rf /' })).toBeUndefined()
  })

  it('rejects malformed capability, activity, and accepted response payloads', () => {
    expect(restartStatusOf({ ...supervised, unavailableReason: 'not-supervised' })).toBeUndefined()
    expect(restartCheckOf({ kind: 'active-work', status: supervised, activity: { hasActive: false, items: [] } })).toBeUndefined()
    expect(restartRequestOf({ kind: 'scheduled' })).toBeUndefined()
  })
})
