/**
 * Post-activation verification for the user-service CLI.
 *
 * `activate` is the one moment the installer can still tell the truth cheaply:
 * the definition it just staged either takes over the port, or it enters the
 * respawn loop this plugin exists to avoid. Claiming success while a supervisor
 * spins at one failed start every few seconds is exactly the silent failure that
 * motivated this check.
 *
 * The judgement is file evidence plus native state, never a guess:
 *
 * - a restart storm (recent boot stamps plus DSH's own `startup-*.log`
 *   diagnostics) means starts are failing back to back;
 * - no tracked process inside the deadline means the service never came up.
 */

import { RESTART_STORM_THRESHOLD, RESTART_STORM_WINDOW_MS, bootStampFile, countRecentRestarts, serviceLogDir } from '../shared/restart-evidence.ts'
import { SYSTEMD_UNIT, WINDOWS_TASK_NAME, parseLaunchdTrackedPid, parseSystemdMainPid, parseWindowsTaskRunning } from '../shared/service-platform.ts'
import type { CommandRunner, ServiceSpec } from './types.ts'

export type ServiceVerification =
  | { readonly kind: 'settled' }
  | { readonly kind: 'crash-loop'; readonly recentRestarts: number; readonly windowMs: number }
  | { readonly kind: 'not-running' }

export interface ServiceState {
  readonly running: boolean
  readonly pid?: number
}

export const ACTIVATION_VERIFY_ATTEMPTS = 4
export const ACTIVATION_VERIFY_INTERVAL_MS = 5_000

export async function observeServiceState(
  spec: ServiceSpec,
  run: CommandRunner,
  uid: number,
): Promise<ServiceState> {
  if (spec.platform === 'darwin') {
    const result = run('launchctl', ['print', `gui/${String(uid)}/${spec.label}`])
    const pid = parseLaunchdTrackedPid(result.stdout)
    return pid === undefined ? { running: false } : { running: true, pid }
  }
  if (spec.platform === 'linux') {
    const result = run('systemctl', ['--user', 'show', SYSTEMD_UNIT, '-p', 'MainPID', '--value'])
    const pid = parseSystemdMainPid(result.stdout)
    return pid === undefined ? { running: false } : { running: true, pid }
  }
  const result = run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}').State`,
  ])
  return { running: parseWindowsTaskRunning(result.stdout) }
}

export interface VerifyOptions {
  readonly run: CommandRunner
  readonly uid?: number
  readonly attempts?: number
  readonly intervalMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  /** Injected in tests; defaults to the shared storm evidence on disk. */
  readonly recentRestarts?: () => number
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

export async function verifyActivatedService(spec: ServiceSpec, options: VerifyOptions): Promise<ServiceVerification> {
  const attempts = options.attempts ?? ACTIVATION_VERIFY_ATTEMPTS
  const intervalMs = options.intervalMs ?? ACTIVATION_VERIFY_INTERVAL_MS
  const sleep = options.sleep ?? defaultSleep
  const uid = options.uid ?? 0
  const recentRestarts = options.recentRestarts ?? ((): number => countRecentRestarts(serviceLogDir(), bootStampFile(), Date.now(), RESTART_STORM_WINDOW_MS))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // A storm is decisive on any sample: it means the supervisor cannot finish a
    // start, whether or not a process is briefly alive.
    const restarts = recentRestarts()
    if (restarts >= RESTART_STORM_THRESHOLD) return { kind: 'crash-loop', recentRestarts: restarts, windowMs: RESTART_STORM_WINDOW_MS }
    const state = await observeServiceState(spec, options.run, uid)
    if (state.running) {
      // Give it one more interval to prove it is not immediately respawning.
      if (attempt === attempts - 1) return { kind: 'settled' }
      await sleep(intervalMs)
      continue
    }
    if (attempt === attempts - 1) return { kind: 'not-running' }
    await sleep(intervalMs)
  }
  return { kind: 'not-running' }
}
