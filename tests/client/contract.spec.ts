/** RPC status boundary specs. */
import { describe, expect, it } from 'vitest'
import { restartCheckOf, restartRequestOf, restartStatusOf, updateStatusOf } from '../../src/client/contract.ts'

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '0.2.2-alpha.1', tag: 'next', publishedAt: '2026-09-10T03:12:53.293Z',
    line: '0.2.2', command: 'npm install -g @deepseek-ai/dsh@0.2.2-alpha.1', ...overrides,
  }
}

function payload(overrides: Record<string, unknown> = {}, warnings: unknown = []): Record<string, unknown> {
  return {
    currentVersion: '0.2.1-rc.3', releases: [candidate()], hasUpdate: true,
    cached: false, checkedAt: null, warning: null, warnings,
    installKind: 'npm-global', releaseUrl: 'https://example.test/releases',
    changelogUrl: 'https://example.test/releases', packageName: '@deepseek-ai/dsh',
    canApplyInPlace: false, ...overrides,
  }
}

/** A 0.4.x Host: one `latestVersion`, no `releases` array. */
function legacyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const legacy = payload()
  // A 0.4.x Host never sent the array; dropping the key is the whole fixture.
  delete legacy.releases
  return {
    ...legacy,
    latestVersion: '0.2.1-alpha.1',
    compatibility: 'unverified',
    upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
    publishedAt: '2026-09-10T03:12:53.293Z',
    ...overrides,
  }
}

const stale = { code: 'stale-schemastery', version: '3.18.2', path: '/p/node_modules/@deepseek-ai/schemastery/lib/index.cjs', nodeModulesDir: '/p/node_modules' }

describe('RPC status boundary', () => {
  it('accepts every structured warning the Host can still produce', () => {
    const warnings = [stale, { code: 'registry-unavailable', detail: 'offline' }, { code: 'version-incomparable', currentVersion: '0.2.0-rc.2', latestVersion: 'nightly' }]
    expect(updateStatusOf(payload({}, warnings))?.warnings).toEqual(warnings)
  })

  it('rejects the retired version-unverified warning code', () => {
    // 0.5.0 dropped compatibility entirely; a warning nobody can render must not
    // reach the panel as an unrecognised code.
    expect(updateStatusOf(payload({}, [{ code: 'version-unverified', version: '0.2.1-alpha.1' }]))).toBeUndefined()
  })

  it('accepts stale-schemastery with unreadable version and directory', () => {
    const unknown = { ...stale, version: null, nodeModulesDir: null }
    expect(updateStatusOf(payload({}, [unknown]))?.warnings).toEqual([unknown])
  })

  it('carries every release candidate through the guard, in the order received', () => {
    const releases = [
      candidate(),
      candidate({ version: '0.2.1-rc.4', tag: null, line: '0.2.1' }),
      candidate({ version: '0.2.1-rc.3', tag: 'latest', publishedAt: null, command: null }),
    ]
    const status = updateStatusOf(payload({ releases }))
    expect(status?.releases).toEqual(releases)
    expect(status?.hasUpdate).toBe(true)
    // No re-sorting and no de-duplication: the Host's order is the contract.
    expect(status?.releases.map(release => release.version)).toEqual(['0.2.2-alpha.1', '0.2.1-rc.4', '0.2.1-rc.3'])
    expect(status?.releases[2]?.command).toBeNull()
  })

  it('keeps a command-less candidate honest instead of inventing one', () => {
    const status = updateStatusOf(payload({ installKind: 'source-checkout', releases: [candidate({ command: null })] }))
    expect(status?.releases[0]?.command).toBeNull()
    expect(status?.installKind).toBe('source-checkout')
  })

  it('folds an empty command into null so no copy button can copy nothing', () => {
    expect(updateStatusOf(payload({ releases: [candidate({ command: '' })] }))?.releases[0]?.command).toBeNull()
  })

  it('rejects malformed release candidates rather than rendering a half card', () => {
    expect(updateStatusOf(payload({ releases: [candidate({ line: undefined })] }))).toBeUndefined()
    expect(updateStatusOf(payload({ releases: [candidate({ version: '' })] }))).toBeUndefined()
    expect(updateStatusOf(payload({ releases: [candidate({ tag: 7 })] }))).toBeUndefined()
    expect(updateStatusOf(payload({ releases: [candidate({ publishedAt: 7 })] }))).toBeUndefined()
    expect(updateStatusOf(payload({ releases: [candidate({ command: 7 })] }))).toBeUndefined()
    expect(updateStatusOf(payload({ releases: ['0.2.2-alpha.1'] }))).toBeUndefined()
    expect(updateStatusOf(payload({ releases: '0.2.2-alpha.1' }))).toBeUndefined()
  })

  it('refuses a payload whose hasUpdate disagrees with its own release list', () => {
    // The chip reads hasUpdate, the panel reads releases: a disagreement would
    // paint an amber "update available" dot over an empty panel.
    expect(updateStatusOf(payload({ releases: [], hasUpdate: true }))).toBeUndefined()
    expect(updateStatusOf(payload({ releases: [candidate()], hasUpdate: false }))).toBeUndefined()
  })

  it('accepts the up-to-date answer with no card at all', () => {
    const status = updateStatusOf(payload({ releases: [], hasUpdate: false }))
    expect(status?.releases).toEqual([])
    expect(status?.hasUpdate).toBe(false)
  })

  it('synthesizes the single legacy candidate when releases is absent', () => {
    const status = updateStatusOf(legacyPayload())
    expect(status?.releases).toEqual([{
      version: '0.2.1-alpha.1', tag: null, publishedAt: '2026-09-10T03:12:53.293Z',
      line: '0.2.1', command: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
    }])
    expect(status?.hasUpdate).toBe(true)
  })

  it('synthesizes it for an empty releases array too', () => {
    expect(updateStatusOf(legacyPayload({ releases: [] }))?.releases).toHaveLength(1)
  })

  it('does not put legacy guidance prose into a copyable command', () => {
    // 0.4.x sent a sentence in upgradeCommand for these kinds; rendering it inside
    // a <code> with a copy button would offer the operator a fake command.
    const prose = 'Update the DSH source checkout, install its dependencies, and rebuild it; this plugin cannot replace it in place from the GUI'
    const status = updateStatusOf(legacyPayload({ installKind: 'source-checkout', upgradeCommand: prose }))
    expect(status?.releases).toHaveLength(1)
    expect(status?.releases[0]?.command).toBeNull()
  })

  it('keeps the legacy up-to-date answer as a cardless panel', () => {
    const status = updateStatusOf(legacyPayload({ latestVersion: null, hasUpdate: false }))
    expect(status?.releases).toEqual([])
    expect(status?.hasUpdate).toBe(false)
  })

  it('still rejects a legacy payload whose latestVersion cannot become a candidate', () => {
    expect(updateStatusOf(legacyPayload({ latestVersion: null }))).toBeUndefined()
    expect(updateStatusOf(legacyPayload({ latestVersion: '' }))).toBeUndefined()
  })

  it('rejects missing/invalid status facts and malformed warnings', () => {
    expect(updateStatusOf(payload({ currentVersion: undefined }))).toBeUndefined()
    expect(updateStatusOf(payload({ cached: 'no' }))).toBeUndefined()
    expect(updateStatusOf(payload({ installKind: 'homebrew' }))).toBeUndefined()
    expect(updateStatusOf(payload({ releaseUrl: undefined }))).toBeUndefined()
    expect(updateStatusOf(payload({ canApplyInPlace: true }))).toBeUndefined()
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

  it.each([
    'not-supervised', 'desktop', 'supervisor-mismatch', 'supervisor-thrashing',
    'activity-unavailable', 'timer-unavailable', 'stale-instance',
  ])('accepts the Host refusal %s without losing its recovery steps', unavailableReason => {
    const status = { ...supervised, available: false, unavailableReason, recovery: { commands: 'inspect service\nrecover service' } }
    expect(restartStatusOf(status)).toEqual(status)
    expect(restartCheckOf({ kind: 'unavailable', status })).toEqual({ kind: 'unavailable', status })
    expect(restartRequestOf({ kind: 'unavailable', status })).toEqual({ kind: 'unavailable', status })
  })

  it('rejects malformed capability, activity, and accepted response payloads', () => {
    expect(restartStatusOf({ ...supervised, unavailableReason: 'not-supervised' })).toBeUndefined()
    expect(restartCheckOf({ kind: 'active-work', status: supervised, activity: { hasActive: false, items: [] } })).toBeUndefined()
    expect(restartRequestOf({ kind: 'scheduled' })).toBeUndefined()
  })
})
