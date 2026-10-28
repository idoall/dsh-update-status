/**
 * dsh-update-status — sidebar chip state classification specs.
 *
 * The regression these lock down is a misclassified advisory: a healthy read that
 * carries a plugin-side notice (today: a stale `@deepseek-ai/schemastery` copy that
 * only degrades the settings form) must not repaint the whole version chip as a
 * failure. The chip's three loud states stay reserved for loading, a real update
 * and a read the plugin could not complete.
 */
import { describe, expect, it } from 'vitest'
import { isChipProblem, visualState } from '../../src/shared/visual-state.ts'
import type { UpdateStatus } from '../../src/shared/types.ts'

function statusWith(overrides: Partial<UpdateStatus>): UpdateStatus {
  return {
    currentVersion: '0.1.6-alpha.1',
    releases: [],
    hasUpdate: true,
    cached: true,
    checkedAt: '2026-09-18T04:00:00.000Z',
    warning: null,
    installKind: 'npm-global',
    releaseUrl: 'https://example.invalid/releases',
    changelogUrl: 'https://example.invalid/releases',
    packageName: '@deepseek-ai/dsh',
    canApplyInPlace: false,
    ...overrides,
  }
}

const ADVISORY = 'This plugin resolved @deepseek-ai/schemastery 3.18.2 from /tmp/stale, not the copy DSH provides.'
const FAILURE = '无法检查 npm registry：offline'

describe('sidebar chip visual state', () => {
  it('keeps the chip out of the problem state for an advisory notice', () => {
    const status = statusWith({ hasUpdate: false, warning: ADVISORY, warningKind: 'notice' })
    expect(isChipProblem(status)).toBe(false)
    expect(visualState(status, false, null)).toBe('current')
  })

  it('still reports a failed read as a problem', () => {
    const status = statusWith({ hasUpdate: false, warning: FAILURE, warningKind: 'failure' })
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
    const stale = statusWith({ warning: null, warningKind: null, hasUpdate: false })
    expect(visualState(stale, false, 'RPC unavailable')).toBe('problem')
  })

  it('reports loading before any status arrives', () => {
    expect(visualState(null, true, null)).toBe('loading')
    expect(visualState(statusWith({ hasUpdate: false }), false, null)).toBe('current')
  })
})
