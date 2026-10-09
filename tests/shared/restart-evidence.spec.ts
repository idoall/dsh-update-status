import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BOOT_STAMP_FILE,
  RESTART_STORM_THRESHOLD,
  bootStampFile,
  countRecentBootStamps,
  countRecentRestarts,
  countRecentStartupFailures,
  dshHomeOf,
  readBootStamps,
  recordBootStamp,
  serviceLogDir,
} from '../../src/shared/restart-evidence.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dus-evidence-'))
  roots.push(root)
  return root
}

describe('restart evidence paths', () => {
  it('follows DSH_HOME and falls back to the conventional home', () => {
    expect(dshHomeOf({ DSH_HOME: '/tmp/custom' })).toBe('/tmp/custom')
    expect(dshHomeOf({ DSH_HOME: '   ', HOME: '/home/me' })).toBe(join('/home/me', '.dsh'))
    expect(dshHomeOf({ HOME: '/home/me' })).toBe(join('/home/me', '.dsh'))
    expect(serviceLogDir({ DSH_HOME: '/tmp/custom' })).toBe(join('/tmp/custom', 'logs'))
    expect(bootStampFile({ DSH_HOME: '/tmp/custom' })).toBe(join('/tmp/custom', 'logs', BOOT_STAMP_FILE))
  })
})

describe('boot stamps', () => {
  it('round-trips stamps, ignores junk lines, and is safe when the file is missing', () => {
    const root = scratch()
    const path = join(root, 'nested', 'boots.log')
    expect(readBootStamps(path)).toEqual([])
    recordBootStamp(path, { pid: 10, instanceId: 'a', supervisor: 'launchd', at: 1_000 })
    recordBootStamp(path, { pid: 11, instanceId: 'b', supervisor: null, at: 2_000 })
    expect(readBootStamps(path)).toEqual([
      { at: 1_000, pid: 10, instanceId: 'a', supervisor: 'launchd' },
      { at: 2_000, pid: 11, instanceId: 'b', supervisor: null },
    ])
    // A torn or hand-edited line is not evidence, and must not hide the good ones.
    writeFileSync(path, 'not json\n{"at":"soon","pid":1}\n', 'utf8')
    expect(readBootStamps(path)).toEqual([])
    recordBootStamp(path, { pid: 12, instanceId: 'c', supervisor: 'systemd', at: 3_000 })
    expect(readBootStamps(path)).toEqual([
      { at: 3_000, pid: 12, instanceId: 'c', supervisor: 'systemd' },
    ])
  })

  it('counts only stamps inside the window', () => {
    const stamps = [
      { at: 1_000, pid: 1, instanceId: 'a', supervisor: null },
      { at: 179_000, pid: 2, instanceId: 'b', supervisor: null },
      { at: 300_000, pid: 3, instanceId: 'c', supervisor: null },
    ]
    expect(countRecentBootStamps(stamps, 181_000, 180_000)).toBe(2)
    expect(countRecentBootStamps(stamps, 400_000, 180_000)).toBe(1)
    // A stamp well into the future is a clock that moved backwards, not a restart.
    expect(countRecentBootStamps([{ at: 60_000, pid: 1, instanceId: 'a', supervisor: null }], 0, 180_000)).toBe(0)
    // A just-written stamp can sit a fraction of a millisecond ahead of Date.now()
    // because filesystem timestamps are rounded; that one is the newest evidence.
    expect(countRecentBootStamps([{ at: 1_500, pid: 1, instanceId: 'a', supervisor: null }], 1_000, 180_000)).toBe(1)
  })
})

describe('restart storm evidence', () => {
  it('counts recent DSH startup diagnostics and ignores older ones', () => {
    const root = scratch()
    const at = 2_000_000
    const fresh = join(root, 'startup-2026-10-08T23-40-00.000Z-fresh.log')
    const stale = join(root, 'startup-2026-10-08T20-00-00.000Z-stale.log')
    const unrelated = join(root, 'something-else.log')
    writeFileSync(fresh, 'boom', 'utf8')
    writeFileSync(stale, 'old', 'utf8')
    writeFileSync(unrelated, 'not evidence', 'utf8')
    utimesSync(fresh, at / 1_000, at / 1_000)
    utimesSync(stale, (at - 600_000) / 1_000, (at - 600_000) / 1_000)
    expect(countRecentStartupFailures(root, at, 180_000)).toBe(1)
    expect(countRecentStartupFailures(join(root, 'missing'), at, 180_000)).toBe(0)
  })

  it('sums both halves so a loop of successful or failed boots is visible', () => {
    const root = scratch()
    const logDir = join(root, 'logs')
    mkdirSync(logDir, { recursive: true })
    const bootLog = join(logDir, BOOT_STAMP_FILE)
    const at = 5_000_000
    recordBootStamp(bootLog, { pid: 1, instanceId: 'a', supervisor: 'launchd', at })
    writeFileSync(join(logDir, 'startup-now.log'), 'boom', 'utf8')
    utimesSync(join(logDir, 'startup-now.log'), at / 1_000, at / 1_000)
    expect(countRecentRestarts(logDir, bootLog, at)).toBe(2)
    expect(statSync(bootLog).size).toBeGreaterThan(0)
    expect(RESTART_STORM_THRESHOLD).toBe(4)
  })
})
