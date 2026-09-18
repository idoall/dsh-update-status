/**
 * dsh-update-status — verified-release list specs.
 *
 * `src/shared/types.ts` and `package.json` both declare which DSH releases this
 * bundle has been verified against, and the two drifting apart is a silent bug:
 * the sidebar chip would call a release verified while DSH's own plugin metadata
 * still advertises the old list (or the reverse). This spec keeps them identical.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VERIFIED_DSH_VERSIONS } from '../../src/shared/types.ts'

interface PackageManifest {
  dsh: { compatibility: { dshReleases: Record<string, string> } }
}

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageManifest

describe('verified DSH releases', () => {
  it('matches package.json dsh.compatibility.dshReleases exactly', () => {
    expect([...VERIFIED_DSH_VERSIONS].sort()).toEqual(Object.keys(manifest.dsh.compatibility.dshReleases).sort())
  })

  it('declares every listed release as compatible, with no caveat', () => {
    for (const [release, verdict] of Object.entries(manifest.dsh.compatibility.dshReleases)) {
      expect(verdict, release).toBe('compatible')
    }
  })

  it('carries no duplicates and no empty entries', () => {
    expect(new Set(VERIFIED_DSH_VERSIONS).size).toBe(VERIFIED_DSH_VERSIONS.length)
    for (const release of VERIFIED_DSH_VERSIONS) expect(release.trim()).not.toBe('')
  })
})
