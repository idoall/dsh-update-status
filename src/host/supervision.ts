/**
 * Platform ownership of the running DSH Web process, plus restart-storm evidence.
 *
 * The environment marker (`DSH_WEB_SUPERVISOR`) is necessary but *not* sufficient:
 * every descendant of a supervised process inherits it. A foreign launcher — a
 * second plugin's restart helper, a `nohup` script — therefore looks supervised
 * while the real job is stuck respawning a process that can never bind the port.
 * The panel would offer a destructive restart and promise a recovery the platform
 * cannot deliver, so ownership is asked of the platform itself:
 *
 * - launchd: the tracked pid of our fixed job label must be this process or its
 *   wrapper parent (asked by label, never from the environment);
 * - systemd: the unit's `MainPID` must be this process or its wrapper parent;
 * - Task Scheduler: the parent process must be the wrapper this plugin installed.
 *
 * Anything unverifiable fails closed: restart is destructive, and a false "yes"
 * strands the page, while a false "no" only asks the user to restart DSH by hand.
 */

import { execFile } from 'node:child_process'

import { RESTART_STORM_THRESHOLD, RESTART_STORM_WINDOW_MS, bootStampFile, countRecentRestarts, recordBootStamp } from '../shared/restart-evidence.ts'
import {
  LAUNCHD_LABEL,
  SYSTEMD_UNIT,
  WINDOWS_WRAPPER_BASENAME,
  parseLaunchdTrackedPid,
  parseSystemdMainPid,
} from '../shared/service-platform.ts'

export type OwnershipVerdict = 'owned' | 'not-owner' | 'unverifiable'

export type SupervisorHealth =
  | { readonly kind: 'owned' }
  | { readonly kind: 'not-owner' }
  | { readonly kind: 'unverifiable' }
  | { readonly kind: 'thrashing'; readonly recentRestarts: number; readonly windowMs: number }

export interface ProbeRunResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
}

export type ProbeRun = (file: string, args: readonly string[]) => Promise<ProbeRunResult>

function defaultRun(file: string, args: readonly string[]): Promise<ProbeRunResult> {
  return new Promise(resolve => {
    execFile(file, [...args], { encoding: 'utf8', timeout: 5_000, windowsHide: true }, (error, stdout, stderr) => {
      const code = error === null ? 0 : (error as { code?: unknown }).code
      resolve({
        status: typeof code === 'number' ? code : error === null ? 0 : null,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        ...(error === null ? {} : { error: error.message }),
      })
    })
  })
}

export interface OwnershipProbeOptions {
  readonly platform?: NodeJS.Platform
  readonly pid?: number
  readonly ppid?: number
  readonly uid?: number
  readonly run?: ProbeRun
}

export async function probeSupervisorOwnership(options: OwnershipProbeOptions = {}): Promise<OwnershipVerdict> {
  const platform = options.platform ?? process.platform
  const pid = options.pid ?? process.pid
  const ppid = options.ppid ?? process.ppid
  const run = options.run ?? defaultRun
  try {
    if (platform === 'darwin') {
      const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)
      if (uid === undefined) return 'unverifiable'
      const result = await run('/bin/launchctl', ['print', `gui/${String(uid)}/${LAUNCHD_LABEL}`])
      // A missing launchctl is a probe failure, not proof of ownership.
      if (result.status === null && result.error !== undefined) return 'unverifiable'
      const tracked = parseLaunchdTrackedPid(result.stdout)
      if (tracked === undefined) return 'not-owner'
      return tracked === pid || tracked === ppid ? 'owned' : 'not-owner'
    }
    if (platform === 'linux') {
      const result = await run('systemctl', ['--user', 'show', SYSTEMD_UNIT, '-p', 'MainPID', '--value'])
      if (result.status === null && result.error !== undefined) return 'unverifiable'
      const tracked = parseSystemdMainPid(result.stdout)
      if (tracked === undefined) return 'not-owner'
      return tracked === pid || tracked === ppid ? 'owned' : 'not-owner'
    }
    if (platform === 'win32') {
      // Task Scheduler exposes no pid we can trust, so ownership is "my parent is
      // the wrapper this plugin staged". The wrapper starts DSH in the foreground,
      // which makes the parent link the one signal a foreign launcher cannot forge
      // by inheriting an environment variable.
      const result = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(ppid)}").CommandLine`,
      ])
      if (result.status === null && result.error !== undefined) return 'unverifiable'
      return result.stdout.includes(WINDOWS_WRAPPER_BASENAME) ? 'owned' : 'not-owner'
    }
    return 'unverifiable'
  } catch {
    return 'unverifiable'
  }
}

/**
 * Ownership is cheap to cache: the answer cannot change while a restart is not in
 * flight, and the status route is polled by every open panel.
 */
export function cacheOwnershipProbe(
  probe: () => Promise<OwnershipVerdict>,
  ttlMs = 10_000,
  now: () => number = Date.now,
): () => Promise<OwnershipVerdict> {
  let cached: { at: number; verdict: OwnershipVerdict } | undefined
  let inflight: Promise<OwnershipVerdict> | undefined
  return async () => {
    if (cached !== undefined && now() - cached.at < ttlMs) return cached.verdict
    if (inflight !== undefined) return inflight
    inflight = probe()
      .catch((): OwnershipVerdict => 'unverifiable')
      .then(verdict => {
        cached = { at: now(), verdict }
        return verdict
      })
      .finally(() => { inflight = undefined })
    return inflight
  }
}

export function classifySupervisorHealth(
  ownership: OwnershipVerdict,
  recentRestarts: number,
  windowMs: number = RESTART_STORM_WINDOW_MS,
  threshold: number = RESTART_STORM_THRESHOLD,
): SupervisorHealth {
  if (ownership === 'unverifiable') return { kind: 'unverifiable' }
  if (ownership === 'not-owner') return { kind: 'not-owner' }
  if (recentRestarts >= threshold) return { kind: 'thrashing', recentRestarts, windowMs }
  return { kind: 'owned' }
}

export interface SupervisorHealthOptions {
  readonly logDir: string
  readonly bootLog: string
  readonly probe?: () => Promise<OwnershipVerdict>
  readonly now?: () => number
  readonly windowMs?: number
  readonly threshold?: number
}

/**
 * Ownership first, storm second: "not the supervisor's own process" is the more
 * precise explanation whenever both are true.
 */
export function createSupervisorHealth(options: SupervisorHealthOptions): () => Promise<SupervisorHealth> {
  const now = options.now ?? Date.now
  const windowMs = options.windowMs ?? RESTART_STORM_WINDOW_MS
  const threshold = options.threshold ?? RESTART_STORM_THRESHOLD
  const probe = options.probe ?? cacheOwnershipProbe(() => probeSupervisorOwnership(), 10_000, now)
  return async () => {
    const ownership = await probe()
    if (ownership !== 'owned') return classifySupervisorHealth(ownership, 0, windowMs, threshold)
    return classifySupervisorHealth(ownership, countRecentRestarts(options.logDir, options.bootLog, now(), windowMs), windowMs, threshold)
  }
}

const BOOT_STAMPED = Symbol.for('dsh-update-status/boot-stamped')

/**
 * One stamp per Node process, not per plugin composition: DSH can recompose this
 * plugin (HMR) inside a generation that already stamped itself, and counting
 * those would fake a storm.
 */
export function recordBootOnce(stamp: { pid: number; instanceId: string; supervisor: string | null }, path: string = bootStampFile()): boolean {
  const carrier = globalThis as typeof globalThis & { [BOOT_STAMPED]?: true }
  if (carrier[BOOT_STAMPED] === true) return false
  carrier[BOOT_STAMPED] = true
  recordBootStamp(path, stamp)
  return true
}
