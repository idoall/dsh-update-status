/**
 * dsh-update-status — sidebar chip state classification specs.
 *
 * The regression these lock down: DSH `0.1.6-alpha.2` shipped after this bundle's
 * verified-release list, the Host reported an honest advisory ("alpha 是预览通道，
 * 版本 0.1.6-alpha.2 尚未验证与本插件兼容。"), and the chip classified that advisory
 * as a failure — so the whole version chip turned red on a perfectly healthy read.
 * An operator upgrading DSH ahead of the plugin must never see that.
 */
import { describe, expect, it } from 'vitest'
import { isChipProblem, visualState } from '../../src/shared/visual-state.ts'
import type { UpdateStatus } from '../../src/shared/types.ts'

function statusWith(overrides: Partial<UpdateStatus>): UpdateStatus {
  return {
    currentVersion: '0.1.6-alpha.1',
    latestVersion: '0.1.6-alpha.2',
    hasUpdate: true,
    compatibility: 'unverified',
    cached: true,
    checkedAt: '2026-09-18T04:00:00.000Z',
    warning: null,
    installKind: 'npm-global',
    upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.1.6-alpha.2',
    releaseUrl: 'https://example.invalid/releases',
    changelogUrl: 'https://example.invalid/releases',
    publishedAt: '2026-09-17T13:52:00.000Z',
    packageName: '@deepseek-ai/dsh',
    canApplyInPlace: false,
    ...overrides,
  }
}

const ADVISORY = '版本 0.1.6-alpha.2 尚未验证与本插件兼容。'
const FAILURE = '无法检查 npm registry：offline'

describe('sidebar chip visual state', () => {
  it('keeps the chip out of the problem state for an advisory notice', () => {
    const status = statusWith({ hasUpdate: false, latestVersion: null, warning: ADVISORY, warningKind: 'notice' })
    expect(isChipProblem(status)).toBe(false)
    expect(visualState(status, false, null)).toBe('current')
  })

  it('still reports a failed read as a problem', () => {
    const status = statusWith({ hasUpdate: false, latestVersion: null, warning: FAILURE, warningKind: 'failure' })
    expect(isChipProblem(status)).toBe(true)
    expect(visualState(status, false, null)).toBe('problem')
  })

  it('shows the update state whenever a newer release exists, warning or not', () => {
    expect(visualState(statusWith({ hasUpdate: true, warning: ADVISORY, warningKind: 'notice' }), false, null)).toBe('update')
    expect(visualState(statusWith({ hasUpdate: true, warning: FAILURE, warningKind: 'failure' }), false, null)).toBe('update')
  })

  it('treats an unknown advisory text from an older Host as a problem', () => {
    // No `warningKind`: the previous behaviour must survive, because a real failure
    // from an older Host is indistinguishable here from an advisory.
    const legacy = statusWith({ warning: ADVISORY })
    expect(legacy.warningKind).toBeUndefined()
    expect(isChipProblem(legacy)).toBe(true)
  })

  it('keeps a client-side read error authoritative', () => {
    const stale = statusWith({ warning: null, warningKind: null, hasUpdate: false, latestVersion: null })
    expect(visualState(stale, false, 'RPC unavailable')).toBe('problem')
  })
  it('reports loading before any status arrives', () => {
    expect(visualState(null, true, null)).toBe('loading')
    expect(visualState(statusWith({ hasUpdate: false, latestVersion: null }), false, null)).toBe('current')
  })
})
