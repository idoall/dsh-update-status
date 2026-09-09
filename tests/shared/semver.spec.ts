import { describe, expect, it } from 'vitest'
import { compareSemver, hasSemverUpdate, parseSemver } from '../../src/shared/semver.ts'

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
