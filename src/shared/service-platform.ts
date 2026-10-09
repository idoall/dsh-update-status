/**
 * How each platform reports the state of the user service this plugin stages.
 *
 * Shared between the Host's ownership probe and the CLI's post-activation check
 * so both read the same output with the same rules; the strings are the only
 * stable interface those commands offer.
 */

/**
 * The launchd job this plugin stages. It is a fixed constant rather than something
 * read back from the environment: the job environment launchd configures does
 * carry `XPC_SERVICE_NAME=<label>`, but that value does not survive to the DSH
 * process behind the staged `/bin/sh` wrapper — the Host reads `XPC_SERVICE_NAME=0`
 * — so ownership must be asked of launchd by label.
 */
export const LAUNCHD_LABEL = 'com.idoall.dsh-update-status.web'
export const SYSTEMD_UNIT = 'dsh-update-status-web.service'
export const WINDOWS_TASK_NAME = 'DSH Update Status Web'
export const WINDOWS_WRAPPER_BASENAME = 'dsh-web-supervisor.ps1'

/** The first `pid = N` of `launchctl print` output is the job's tracked process. */
export function parseLaunchdTrackedPid(output: string): number | undefined {
  const match = /(?:^|\n)[^\S\n]*pid = (\d+)/.exec(output)
  if (match?.[1] === undefined) return undefined
  const pid = Number(match[1])
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** `systemctl --user show -p MainPID --value` prints the pid alone, or `0`. */
export function parseSystemdMainPid(output: string): number | undefined {
  const value = output.trim().split('\n')[0]?.trim() ?? ''
  if (!/^\d+$/.test(value)) return undefined
  const pid = Number(value)
  return pid > 0 ? pid : undefined
}

/** `(Get-ScheduledTask -TaskName ...).State` names its state in English. */
export function parseWindowsTaskRunning(output: string): boolean {
  return /(?:^|\W)running(?:\W|$)/i.test(output)
}
