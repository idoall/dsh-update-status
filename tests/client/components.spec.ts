/**
 * Panel card-area specs.
 *
 * The rendering rule the user cares about is "one card per upgradable version,
 * newest first, highlight only the newest, and nothing at all when nothing is
 * newer". That decision lives in `releaseViewOf` — a pure function — so it can be
 * driven here without a DOM, exactly like `visualState`.
 */
import { describe, expect, it } from 'vitest'
import { releaseViewOf } from '../../src/client/components.tsx'
import type { ReleaseCandidate, UpdateStatus } from '../../src/shared/types.ts'

function candidate(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    version: '0.2.2-alpha.1',
    tag: 'next',
    publishedAt: '2026-09-10T03:12:53.293Z',
    line: '0.2.2',
    command: 'npm install -g @deepseek-ai/dsh@0.2.2-alpha.1',
    ...overrides,
  }
}

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    currentVersion: '0.2.1-rc.3',
    releases: [candidate()],
    hasUpdate: true,
    cached: false,
    checkedAt: null,
    warning: null,
    warnings: [],
    installKind: 'npm-global',
    releaseUrl: 'https://example.test/releases',
    changelogUrl: 'https://example.test/releases',
    packageName: '@deepseek-ai/dsh',
    canApplyInPlace: false,
    ...overrides,
  }
}

describe('panel card area', () => {
  it('renders one row per candidate, in the order received, newest first', () => {
    const view = releaseViewOf(status({
      releases: [
        candidate(),
        candidate({ version: '0.2.1-rc.4', tag: null, line: '0.2.1' }),
        candidate({ version: '0.2.1-rc.3', tag: 'latest', line: '0.2.1' }),
      ],
    }))
    expect(view.rows.map(row => row.release.version)).toEqual(['0.2.2-alpha.1', '0.2.1-rc.4', '0.2.1-rc.3'])
    // Highlight is positional: the Host already sorted, so index 0 is the newest.
    expect(view.rows.map(row => row.newest)).toEqual([true, false, false])
    expect(view.copyable).toBe(true)
    expect(view.guidance).toBeNull()
  })

  it('marks a single candidate as the newest one', () => {
    expect(releaseViewOf(status()).rows).toEqual([{ release: candidate(), newest: true }])
  })

  it('renders no card and no command block when nothing is newer', () => {
    const view = releaseViewOf(status({ releases: [], hasUpdate: false }))
    expect(view.rows).toEqual([])
    expect(view.copyable).toBe(false)
    expect(view.guidance).toBeNull()
  })

  it('renders nothing at all before the first successful read', () => {
    const view = releaseViewOf(null)
    expect(view.rows).toEqual([])
    expect(view.copyable).toBe(false)
    expect(view.guidance).toBeNull()
  })

  it('explains a command-less installation once, in the operator’s language', () => {
    const releases = [candidate({ command: null }), candidate({ version: '0.2.1-rc.4', command: null, line: '0.2.1' })]
    const zh = releaseViewOf(status({ installKind: 'source-checkout', releases }), 'zh')
    expect(zh.copyable).toBe(false)
    expect(zh.rows.every(row => row.release.command === null)).toBe(true)
    expect(zh.guidance).toContain('DSH 源码 checkout')

    const en = releaseViewOf(status({ installKind: 'unknown', releases }), 'en')
    expect(en.guidance).toBe(
      'Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you.',
    )
  })

  it('never invents guidance for an installation that was expected to have a command', () => {
    // npm-global with a null command is a Host defect, not a source checkout; the
    // panel stays silent rather than telling the operator to confirm their install.
    expect(releaseViewOf(status({ releases: [candidate({ command: null })] }), 'zh').guidance).toBeNull()
  })
})
