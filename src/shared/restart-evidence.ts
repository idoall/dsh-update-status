/**
 * First-party evidence that a DSH Web Host is being restarted in a storm.
 *
 * A restart is only safe when the supervisor's next start can actually bind the
 * port. When a second launcher owns the port (another plugin's restart helper, a
 * `nohup` script), the supervisor keeps respawning a process that dies with
 * `EADDRINUSE` every few seconds — forever, because `KeepAlive`/`Restart=` has no
 * failure ceiling of its own. Two files make that visible to whichever process
 * is still alive:
 *
 * - one boot stamp appended by every Host generation that reaches this plugin;
 * - DSH's own `startup-*.log` diagnostics, written by every process that fails
 *   to boot (a failing generation never composes this plugin, so it cannot leave
 *   a stamp of its own).
 *
 * Counting both is deliberate: stamps catch a loop of *successful* short-lived
 * boots, diagnostics catch a loop of *failed* ones. Neither is a security
 * boundary — they exist to stop a destructive restart button from lying.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const BOOT_STAMP_FILE = 'dsh-update-status-boots.log'
/** A window this short can only fill up when starts are failing back to back. */
export const RESTART_STORM_WINDOW_MS = 180_000
/** Four starts in three minutes is a storm; a human restart costs ~40s of boot. */
export const RESTART_STORM_THRESHOLD = 4

/** DSH's own per-process failure diagnostics, written into the same log dir. */
const STARTUP_DIAGNOSTIC = /^startup-.*\.log$/
const BOOT_STAMP_MAX_BYTES = 32 * 1024
const BOOT_STAMP_KEEP_LINES = 100
/**
 * Filesystem timestamp rounding can place a file written microseconds ago a
 * fraction of a millisecond ahead of `Date.now()`. Without this slack the most
 * recent failures — the ones that matter — would be dropped from the count.
 */
const CLOCK_SLACK_MS = 1_000

export interface BootStamp {
  readonly at: number
  readonly pid: number
  readonly instanceId: string
  readonly supervisor: string | null
}

export function dshHomeOf(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = env.DSH_HOME?.trim()
  if (configured !== undefined && configured !== '') return configured
  const home = env.HOME?.trim()
  return join(home !== undefined && home !== '' ? home : homedir(), '.dsh')
}

export function serviceLogDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(dshHomeOf(env), 'logs')
}

export function bootStampFile(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(serviceLogDir(env), BOOT_STAMP_FILE)
}

/**
 * Append one line, best effort. A Host must never fail to start because its own
 * restart evidence could not be written, so every filesystem error is swallowed.
 */
export function recordBootStamp(path: string, stamp: { pid: number; instanceId: string; supervisor: string | null; at?: number }): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    trimBootStamps(path)
    appendFileSync(path, `${JSON.stringify({
      at: stamp.at ?? Date.now(),
      pid: stamp.pid,
      instanceId: stamp.instanceId,
      supervisor: stamp.supervisor,
    })}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Evidence is advisory; silence is the only safe failure mode here.
  }
}

function trimBootStamps(path: string): void {
  if (!existsSync(path) || statSync(path).size <= BOOT_STAMP_MAX_BYTES) return
  const kept = readFileSync(path, 'utf8').split('\n').filter(line => line.trim() !== '').slice(-BOOT_STAMP_KEEP_LINES)
  writeFileSync(path, kept.length === 0 ? '' : `${kept.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function readBootStamps(path: string): readonly BootStamp[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const stamps: BootStamp[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      if (typeof value.at !== 'number' || typeof value.pid !== 'number' || typeof value.instanceId !== 'string') continue
      stamps.push({
        at: value.at,
        pid: value.pid,
        instanceId: value.instanceId,
        supervisor: typeof value.supervisor === 'string' ? value.supervisor : null,
      })
    } catch {
      // A torn or hand-edited line is not evidence.
    }
  }
  return stamps
}

export function countRecentBootStamps(stamps: readonly BootStamp[], now: number, windowMs: number): number {
  let count = 0
  for (const stamp of stamps) {
    const age = now - stamp.at
    if (age >= -CLOCK_SLACK_MS && age <= windowMs) count += 1
  }
  return count
}

/** DSH writes one `startup-*.log` per process that failed to boot. */
export function countRecentStartupFailures(logDir: string, now: number, windowMs: number): number {
  let names: readonly string[]
  try {
    names = readdirSync(logDir)
  } catch {
    return 0
  }
  let count = 0
  for (const name of names) {
    if (!STARTUP_DIAGNOSTIC.test(name)) continue
    try {
      const age = now - statSync(join(logDir, name)).mtimeMs
      if (age >= -CLOCK_SLACK_MS && age <= windowMs) count += 1
    } catch {
      // A file that vanished mid-scan is not evidence.
    }
  }
  return count
}

/**
 * Both halves of the storm signal, for callers that only have the paths — the
 * Host's health probe and the service CLI's post-activation check share it.
 */
export function countRecentRestarts(logDir: string, bootLog: string, now: number, windowMs: number = RESTART_STORM_WINDOW_MS): number {
  return countRecentBootStamps(readBootStamps(bootLog), now, windowMs) + countRecentStartupFailures(logDir, now, windowMs)
}
