import { describe, expect, it } from 'vitest'
import { compareSemver, hasSemverUpdate, newestSemver, parseSemver } from '../../src/shared/semver.ts'

describe('SemVer comparison', () => {
  it('parses current prerelease versions', () => {
    expect(parseSemver('0.1.2-rc.1')).toEqual({ major: 0, minor: 1, patch: 2, prerelease: ['rc', '1'] })
    expect(parseSemver('v1.2.3+build.5')).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('orders prereleases before the stable release', () => {
    expect(compareSemver('0.1.2-rc.1', '0.1.2')).toBeLessThan(0)
    expect(compareSemver('0.1.2-rc.10', '0.1.2-rc.2')).toBeGreaterThan(0)
    expect(hasSemverUpdate('0.1.2-rc.1', '0.1.2')).toBe(true)
  })

  it('does not guess for invalid versions', () => {
    expect(parseSemver('latest')).toBeUndefined()
    expect(compareSemver('not-a-version', '1.0.0')).toBeUndefined()
    expect(hasSemverUpdate('not-a-version', '1.0.0')).toBe(false)
  })
})

describe('newestSemver', () => {
  it('picks the highest tagged release, not the tag name', () => {
    // The registry's own answer for this plugin's use case: `latest` is behind
    // `alpha`, and the alpha is what a user can actually update to.
    expect(newestSemver(['0.2.0-rc.2', '0.2.0-rc.2', '0.2.1-alpha.1'])).toBe('0.2.1-alpha.1')
    // A stable release outranks its own prereleases.
    expect(newestSemver(['0.2.0-rc.2', '0.2.0'])).toBe('0.2.0')
    expect(newestSemver(['0.1.7-rc.2', '0.2.0-rc.1'])).toBe('0.2.0-rc.1')
  })

  it('skips what it cannot parse and keeps the winner spelling', () => {
    expect(newestSemver(['nightly', 'v0.2.1-alpha.1', '0.1.0'])).toBe('v0.2.1-alpha.1')
    expect(newestSemver(['nightly', ''])).toBeUndefined()
    expect(newestSemver([])).toBeUndefined()
  })
})
