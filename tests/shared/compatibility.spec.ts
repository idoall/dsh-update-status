/**
 * dsh-update-status — plugin manifest specs.
 *
 * `src/shared/types.ts` and `package.json` both declare which DSH releases this
 * bundle has been verified against, and the two drifting apart is a silent bug:
 * the sidebar chip would call a release verified while DSH's own plugin metadata
 * still advertises the old list (or the reverse). This spec keeps them identical.
 *
 * It also locks the three declarations DSH 0.1.7 needs in order to load the
 * plugin at all — the manifest version, the `dsh.engines.dsh` / peer ranges that
 * must ADMIT every verified release, and the fact that `@deepseek-ai/schemastery`
 * is a peer (a linked plugin resolves only peers from the running installation).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareSemver } from '../../src/shared/semver.ts'
import { VERIFIED_DSH_VERSIONS } from '../../src/shared/types.ts'

interface PackageManifest {
  dsh: {
    manifestVersion?: number
    engines?: { dsh?: string }
    client: { platform: string; inject: string[] }
    compatibility: { dshReleases: Record<string, string> }
  }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageManifest

/** Whether a `>=LOW <HIGH` range admits a version, prereleases included. */
function admits(range: string, version: string): boolean {
  const match = /^>=\s*(\S+)\s+<\s*(\S+)$/.exec(range.trim())
  if (match === null) throw new Error(`unsupported range form: ${range}`)
  const lower = compareSemver(version, match[1]!)
  const upper = compareSemver(version, match[2]!)
  if (lower === undefined || upper === undefined) return false
  return lower >= 0 && upper < 0
}

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

describe('DSH 0.1.7 manifest requirements', () => {
  it('declares the manifest version', () => {
    expect(manifest.dsh.manifestVersion).toBe(1)
  })

  it('admits every verified release through dsh.engines.dsh', () => {
    const range = manifest.dsh.engines?.dsh
    expect(typeof range).toBe('string')
    for (const release of VERIFIED_DSH_VERSIONS) expect(admits(range!, release), `${range} ⊅ ${release}`).toBe(true)
  })

  it('admits every verified release through the dsh-settings peer', () => {
    // DSH 0.1.7 refuses an incompatible bundle at profile load, so a range that
    // excludes the running release would silently drop this plugin.
    const range = manifest.peerDependencies?.['@deepseek-ai/dsh-settings']
    expect(typeof range).toBe('string')
    for (const release of VERIFIED_DSH_VERSIONS) expect(admits(range!, release), `${range} ⊅ ${release}`).toBe(true)
  })

  it('keeps schemastery a peer so a linked install resolves it from DSH', () => {
    expect(manifest.peerDependencies?.['@deepseek-ai/schemastery']).toBeDefined()
    expect(manifest.dependencies?.['@deepseek-ai/schemastery']).toBeUndefined()
  })

  it('injects the client services the browser half addresses', () => {
    // `remote.settings` (the LAN fallback) and `configForms` (the official form
    // channel) both come from these packages.
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-api-remotes')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-settings')
  })
})
