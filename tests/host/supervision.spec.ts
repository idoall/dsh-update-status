import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cacheOwnershipProbe,
  classifySupervisorHealth,
  createSupervisorHealth,
  probeSupervisorOwnership,
  type ProbeRun,
  type ProbeRunResult,
} from '../../src/host/supervision.ts'
import { parseLaunchdTrackedPid, parseSystemdMainPid } from '../../src/shared/service-platform.ts'
import { recordBootStamp } from '../../src/shared/restart-evidence.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dus-supervision-'))
  roots.push(root)
  return root
}

function runner(output: string, status = 0): () => Promise<ProbeRunResult> {
  return async () => ({ status, stdout: output, stderr: '' })
}

const launchdPrint = (pid: number | null): string => `gui/501/com.idoall.dsh-update-status.web = {
\tactive count = 1
\tpath = /Users/me/Library/LaunchAgents/com.idoall.dsh-update-status.web.plist
\tstate = running
${pid === null ? '' : `\tpid = ${String(pid)}\n`}\truns = 671
}
`

describe('supervisor ownership probe', () => {
  it('reads the tracked pid out of launchctl and systemctl output', () => {
    expect(parseLaunchdTrackedPid(launchdPrint(48167))).toBe(48167)
    expect(parseLaunchdTrackedPid(launchdPrint(null))).toBeUndefined()
    expect(parseLaunchdTrackedPid('Bad request.\nCould not find service "x"')).toBeUndefined()
    expect(parseSystemdMainPid('1234\n')).toBe(1234)
    expect(parseSystemdMainPid('0')).toBeUndefined()
    expect(parseSystemdMainPid('')).toBeUndefined()
  })

  it('accepts this process or its wrapper parent, and refuses anything else', async () => {
    const options = { platform: 'darwin' as const, uid: 501, pid: 900, ppid: 899 }
    await expect(probeSupervisorOwnership({ ...options, run: runner(launchdPrint(900)) })).resolves.toBe('owned')
    // The staged wrapper is the job's main process; DSH runs as its child.
    await expect(probeSupervisorOwnership({ ...options, run: runner(launchdPrint(899)) })).resolves.toBe('owned')
    // A foreign restart helper's process: the job is tracked elsewhere, or gone.
    await expect(probeSupervisorOwnership({ ...options, run: runner(launchdPrint(48167)) })).resolves.toBe('not-owner')
    await expect(probeSupervisorOwnership({ ...options, run: runner(launchdPrint(null)) })).resolves.toBe('not-owner')
    await expect(probeSupervisorOwnership({ ...options, run: runner('Could not find service', 113) })).resolves.toBe('not-owner')
  })

  it('fails closed when the platform probe cannot run at all', async () => {
    const missing = async (): Promise<ProbeRunResult> => ({ status: null, stdout: '', stderr: '', error: 'spawn launchctl ENOENT' })
    await expect(probeSupervisorOwnership({ platform: 'darwin', uid: 501, run: missing })).resolves.toBe('unverifiable')
    await expect(probeSupervisorOwnership({ platform: 'linux', run: missing })).resolves.toBe('unverifiable')
    // A platform this plugin cannot verify is never reported as supervised.
    await expect(probeSupervisorOwnership({ platform: 'aix', run: missing })).resolves.toBe('unverifiable')
  })

  it('asks launchd by the job label this plugin stages, not by the environment', async () => {
    // The Host reads XPC_SERVICE_NAME=0 behind the staged wrapper, so a probe that
    // trusted the environment would query a job that cannot exist.
    const seen: string[][] = []
    const probe: ProbeRun = async (_file, args) => {
      seen.push([...args])
      return { status: 0, stdout: launchdPrint(900), stderr: '' }
    }
    await expect(probeSupervisorOwnership({ platform: 'darwin', uid: 501, pid: 900, ppid: 899, run: probe })).resolves.toBe('owned')
    expect(seen).toEqual([['print', 'gui/501/com.idoall.dsh-update-status.web']])
  })

  it('treats the Task Scheduler wrapper as the parent identity', async () => {
    const wrapper = 'powershell.exe -NoProfile -File C:\\Users\\me\\AppData\\Local\\dsh-update-status\\dsh-web-supervisor.ps1'
    await expect(probeSupervisorOwnership({ platform: 'win32', ppid: 42, run: runner(wrapper) })).resolves.toBe('owned')
    await expect(probeSupervisorOwnership({ platform: 'win32', ppid: 42, run: runner('C:\\node.exe dsh web') })).resolves.toBe('not-owner')
  })

  it('caches the verdict for the probe TTL and refetches after it', async () => {
    let calls = 0
    let now = 1_000
    const probe = cacheOwnershipProbe(async () => { calls += 1; return 'owned' }, 10_000, () => now)
    await expect(probe()).resolves.toBe('owned')
    now += 5_000
    await expect(probe()).resolves.toBe('owned')
    expect(calls).toBe(1)
    now += 6_000
    await expect(probe()).resolves.toBe('owned')
    expect(calls).toBe(2)
  })

  it('never lets a throwing probe escape as an exception', async () => {
    const probe = cacheOwnershipProbe(async (): Promise<'owned'> => { throw new Error('boom') })
    await expect(probe()).resolves.toBe('unverifiable')
  })
})

describe('supervisor health classification', () => {
  it('reports ownership first, then a restart storm', () => {
    expect(classifySupervisorHealth('owned', 0)).toEqual({ kind: 'owned' })
    expect(classifySupervisorHealth('not-owner', 99)).toEqual({ kind: 'not-owner' })
    expect(classifySupervisorHealth('unverifiable', 0)).toEqual({ kind: 'unverifiable' })
    expect(classifySupervisorHealth('owned', 4)).toEqual({ kind: 'thrashing', recentRestarts: 4, windowMs: 180_000 })
    // Three starts in the window is still an ordinary restart history.
    expect(classifySupervisorHealth('owned', 3)).toEqual({ kind: 'owned' })
  })

  it('counts boot stamps and DSH startup diagnostics as one storm signal', async () => {
    const root = scratch()
    const logDir = join(root, 'logs')
    const bootLog = join(logDir, 'dsh-update-status-boots.log')
    // Real wall-clock stamps: DSH's startup diagnostics carry real mtimes, and the
    // window compares them.
    const at = Date.now()
    // A single restart: one fresh stamp, nothing else — never a storm.
    recordBootStamp(bootLog, { pid: 1, instanceId: 'a', supervisor: 'launchd', at: at - 600_000 })
    recordBootStamp(bootLog, { pid: 2, instanceId: 'b', supervisor: 'launchd', at })
    const settled = createSupervisorHealth({ logDir, bootLog, probe: async () => 'owned' })
    await expect(settled()).resolves.toEqual({ kind: 'owned' })

    // A failed generation never composes this plugin, so only DSH's own startup
    // diagnostics record it — which is exactly the EADDRINUSE respawn loop.
    for (let index = 0; index < 3; index += 1) {
      writeFileSync(join(logDir, `startup-2026-10-08T23-4${String(index)}-00.000Z-dead.log`), 'boom', 'utf8')
    }
    const storming = createSupervisorHealth({ logDir, bootLog, probe: async () => 'owned' })
    await expect(storming()).resolves.toEqual({ kind: 'thrashing', recentRestarts: 4, windowMs: 180_000 })
  })

  it('keeps ownership as the reason when a foreign process also sees the storm', async () => {
    const root = scratch()
    const logDir = join(root, 'logs')
    const bootLog = join(logDir, 'boots.log')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, 'startup-x.log'), 'boom', 'utf8')
    const health = createSupervisorHealth({ logDir, bootLog, probe: async () => 'not-owner', now: () => Date.now() })
    await expect(health()).resolves.toEqual({ kind: 'not-owner' })
  })
})
