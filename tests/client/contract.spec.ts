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

function payload(warnings: unknown): Record<string, unknown> {
  return {
    currentVersion: '0.1.7-rc.2',
    latestVersion: null,
    hasUpdate: false,
    cached: false,
    checkedAt: null,
    warning: null,
    warnings,
    installKind: 'npm-global',
    upgradeCommand: 'npm install -g @deepseek-ai/dsh@latest',
    releaseUrl: 'https://example.test/releases',
    changelogUrl: 'https://example.test/releases',
    publishedAt: null,
    packageName: '@deepseek-ai/dsh',
    channel: 'latest',
    channels: [{ channel: 'latest', version: null, publishedAt: null, compatibility: 'unverified' }],
    canApplyInPlace: false,
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
    expect(updateStatusOf(payload([stale]))?.warnings).toEqual([stale])
  })

  it('accepts it with an unreadable version and an unknown directory', () => {
    const unknown = { ...stale, version: null, nodeModulesDir: null }
    expect(updateStatusOf(payload([unknown]))?.warnings).toEqual([unknown])
  })

  it('drops a payload whose warning is malformed or unknown', () => {
    expect(updateStatusOf(payload([{ code: 'stale-schemastery', version: '3.18.2' }]))).toBeUndefined()
    expect(updateStatusOf(payload([{ ...stale, path: 7 }]))).toBeUndefined()
    expect(updateStatusOf(payload([{ code: 'something-else' }]))).toBeUndefined()
  })
})
