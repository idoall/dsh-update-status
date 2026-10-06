/**
 * dsh-update-status — RPC status boundary specs.
 *
 * `updateStatusOf` is the one place a Host payload becomes a client value, so a
 * warning code added on the Host side is only usable once this guard knows it.
 * The `stale-schemastery` case is the one added with the shadow-proof peer
 * resolution; the rejection cases keep a malformed payload from rendering as a
 * half-built panel.
 */
import { describe, expect, it } from 'vitest'
import { updateStatusOf } from '../../src/client/contract.ts'

function payload(overrides: Record<string, unknown> = {}, warnings: unknown = []): Record<string, unknown> {
  return {
    currentVersion: '0.2.0-rc.2',
    latestVersion: '0.2.1-alpha.1',
    hasUpdate: true,
    compatibility: 'unverified',
    cached: false,
    checkedAt: null,
    warning: null,
    warnings,
    installKind: 'npm-global',
    upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
    releaseUrl: 'https://example.test/releases',
    changelogUrl: 'https://example.test/releases',
    publishedAt: null,
    packageName: '@deepseek-ai/dsh',
    canApplyInPlace: false,
    ...overrides,
  }
}

const stale = {
  code: 'stale-schemastery',
  version: '3.18.2',
  path: '/p/node_modules/@deepseek-ai/schemastery/lib/index.cjs',
  nodeModulesDir: '/p/node_modules',
}

describe('RPC status boundary', () => {
  it('accepts the stale-schemastery warning', () => {
    expect(updateStatusOf(payload({}, [stale]))?.warnings).toEqual([stale])
  })

  it('accepts it with an unreadable version and an unknown directory', () => {
    const unknown = { ...stale, version: null, nodeModulesDir: null }
    expect(updateStatusOf(payload({}, [unknown]))?.warnings).toEqual([unknown])
  })

  it('accepts every registry warning this Host can produce', () => {
    const warnings = [
      { code: 'registry-unavailable', detail: 'offline' },
      { code: 'version-incomparable', currentVersion: '0.2.0-rc.2', latestVersion: 'nightly' },
      { code: 'version-unverified', version: '0.2.1-alpha.1' },
    ]
    expect(updateStatusOf(payload({}, warnings))?.warnings).toEqual(warnings)
  })

  it('carries the newest release and its compatibility through the guard', () => {
    const status = updateStatusOf(payload())
    expect(status?.latestVersion).toBe('0.2.1-alpha.1')
    expect(status?.hasUpdate).toBe(true)
    expect(status?.compatibility).toBe('unverified')
  })

  it('rejects a payload that is missing the newest release or its compatibility', () => {
    expect(updateStatusOf(payload({ latestVersion: undefined }))).toBeUndefined()
    expect(updateStatusOf(payload({ compatibility: 'maybe' }))).toBeUndefined()
    // A payload from this bundle's previous contract has no `compatibility`, so
    // it is refused rather than rendered with an empty version row.
    const legacy = payload()
    delete legacy.compatibility
    expect(updateStatusOf(legacy)).toBeUndefined()
  })

  it('drops a payload whose warning is malformed or unknown', () => {
    expect(updateStatusOf(payload({}, [{ code: 'stale-schemastery', version: '3.18.2' }]))).toBeUndefined()
    expect(updateStatusOf(payload({}, [{ ...stale, path: 7 }]))).toBeUndefined()
    expect(updateStatusOf(payload({}, [{ code: 'something-else' }]))).toBeUndefined()
    expect(updateStatusOf(payload({}, [{ code: 'version-unverified' }]))).toBeUndefined()
    expect(updateStatusOf(payload({}, [{ code: 'version-incomparable', currentVersion: 'a' }]))).toBeUndefined()
  })
})
