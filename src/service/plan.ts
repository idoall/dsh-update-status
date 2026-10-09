/** Build transparent per-OS user-service definitions; do not install them here. */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { LAUNCHD_LABEL, SYSTEMD_UNIT } from '../shared/service-platform.ts'
import type { CliEnvironment, ServicePaths, ServicePlan, ServicePlatform, ServiceSpec } from './types.ts'

export const SERVICE_LABEL = LAUNCHD_LABEL
export const SUPERVISOR_MARKER = 'dsh-update-status'

/**
 * A child that dies within this many seconds never finished a boot. Consecutive
 * failures past the limit stop the loop instead of respawning forever: a second
 * launcher holding the port turns `KeepAlive`/`Restart=` into an endless
 * `EADDRINUSE` storm, and no native supervisor bounds that by itself.
 */
export const RAPID_FAILURE_WINDOW_SECONDS = 30
export const RAPID_FAILURE_LIMIT = 5
export const RESTART_DELAY_SECONDS = 3
/** systemd's native equivalent of the same ceiling. */
export const SYSTEMD_START_LIMIT_INTERVAL_SECONDS = 300
export const SYSTEMD_START_LIMIT_BURST = 10

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function systemd(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function powerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function boundedPort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('`--port` must be an integer from 1 to 65535')
  return port
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`missing value after ${flag}`)
  return value
}

/**
 * Resolve the real JS file behind `@deepseek-ai/dsh`'s `bin.dsh`, using the
 * selected profile as a Node resolution anchor. This avoids platform shell
 * shims (`dsh.cmd`) and keeps every native service on `node <absolute-js>`.
 */
export function dshPathOf(env: CliEnvironment, profile: string, dshHome: string | undefined, override?: string): string {
  const fromArg = override?.trim()
  if (fromArg !== undefined && fromArg !== '') return isAbsolute(fromArg) ? fromArg : resolve(env.cwd, fromArg)
  const home = dshHome ?? join(env.home || homedir(), '.dsh')
  try {
    const anchor = join(home, 'profiles', profile, 'dsh-update-status-service-resolver.cjs')
    const require = createRequire(anchor)
    const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; bin?: { dsh?: unknown } }
    if (manifest.name !== '@deepseek-ai/dsh' || typeof manifest.bin?.dsh !== 'string') throw new Error('invalid dsh package manifest')
    return realpathSync(join(dirname(manifestPath), manifest.bin.dsh))
  } catch (error) {
    throw new Error(`cannot resolve @deepseek-ai/dsh from profile ${profile}; rerun with --dsh /absolute/path/to/lib/bin.js (${error instanceof Error ? error.message : String(error)})`)
  }
}

export function servicePlatform(value: NodeJS.Platform): ServicePlatform {
  if (value === 'darwin' || value === 'linux' || value === 'win32') return value
  throw new Error(`unsupported platform: ${value}; supported: macOS, Linux, Windows`)
}

export function specFromArgs(args: readonly string[], env: CliEnvironment): ServiceSpec {
  const platform = servicePlatform(env.platform)
  const profile = valueAfter(args, '--profile') ?? env.env.DSH_PROFILE ?? 'web'
  const workspace = valueAfter(args, '--workspace')
  if (workspace === undefined) throw new Error('`--workspace` is required and must be the absolute directory DSH should use')
  const host = valueAfter(args, '--host') ?? '127.0.0.1'
  const port = boundedPort(valueAfter(args, '--port') ?? 3080)
  const home = env.home || homedir()
  const dshHomeArg = valueAfter(args, '--dsh-home')
  const dshHome = dshHomeArg ?? (env.env.DSH_HOME?.trim() || undefined)
  if (dshHome !== undefined && !isAbsolute(dshHome)) throw new Error('`--dsh-home` must be an absolute path')
  const logDir = valueAfter(args, '--log-dir') ?? join(dshHome ?? join(home, '.dsh'), 'logs')
  const dshPath = dshPathOf(env, profile, dshHome, valueAfter(args, '--dsh'))
  const nodePath = valueAfter(args, '--node') ?? env.execPath
  if (!isAbsolute(nodePath)) throw new Error('`--node` must be an absolute executable path')
  if (!isAbsolute(dshPath)) throw new Error('`--dsh` must be an absolute executable path')
  if (!isAbsolute(workspace)) throw new Error('`--workspace` must be an absolute path')
  if (!isAbsolute(logDir)) throw new Error('`--log-dir` must be an absolute path')
  return {
    schemaVersion: 1,
    platform,
    label: SERVICE_LABEL,
    nodePath,
    dshPath,
    profile,
    workspace,
    host,
    port,
    home,
    ...(dshHome === undefined ? {} : { dshHome }),
    logDir,
    supervisorMarker: SUPERVISOR_MARKER,
  }
}

export function pathsFor(spec: ServiceSpec): ServicePaths {
  const root = spec.dshHome ?? join(spec.home, '.dsh')
  const stdoutFile = join(spec.logDir, 'dsh-web-service.stdout.log')
  const stderrFile = join(spec.logDir, 'dsh-web-service.stderr.log')
  if (spec.platform === 'darwin') return {
    stateFile: join(root, 'dsh-update-status-service.json'),
    definitionFile: join(spec.home, 'Library', 'LaunchAgents', `${spec.label}.plist`),
    wrapperFile: join(root, 'dsh-update-status', 'dsh-web-supervisor.sh'),
    stdoutFile,
    stderrFile,
  }
  if (spec.platform === 'linux') return {
    stateFile: join(root, 'dsh-update-status-service.json'),
    definitionFile: join(spec.home, '.config', 'systemd', 'user', 'dsh-update-status-web.service'),
    stdoutFile,
    stderrFile,
  }
  const base = envLocalAppData(spec)
  return {
    stateFile: join(root, 'dsh-update-status-service.json'),
    definitionFile: join(base, 'dsh-update-status', 'dsh-web-task.xml'),
    wrapperFile: join(base, 'dsh-update-status', 'dsh-web-supervisor.ps1'),
    stdoutFile,
    stderrFile,
  }
}

function envLocalAppData(spec: ServiceSpec): string {
  // `LOCALAPPDATA` is intentionally recorded in the state file by the CLI when
  // present. For a portable plan without a Windows process, use the conventional
  // per-user location below the profile home.
  return join(spec.home, 'AppData', 'Local')
}

function webArguments(spec: ServiceSpec): readonly string[] {
  return [spec.dshPath, '--profile', spec.profile, '--host', spec.host, '--port', String(spec.port), '--no-open']
}

function launchdWrapper(spec: ServiceSpec, paths: ServicePaths, uid: number): string {
  const args = [spec.nodePath, ...webArguments(spec)].map(shQuote).join(' ')
  const kickstart = `launchctl kickstart -k gui/${String(uid)}/${spec.label}`
  return `#!/bin/sh
# Managed by dsh-update-status. This wrapper, not launchd, owns the restart loop.
#
# KeepAlive alone respawns forever and has no failure ceiling: as soon as another
# launcher owns the port, every respawn dies with EADDRINUSE in a couple of
# seconds and the machine spins. The loop therefore lives here, where it can stop.
#
#   * RAPID_FAILURE_WINDOW: a child that dies this fast never finished a boot.
#   * RAPID_FAILURE_LIMIT: that many in a row stops the loop and says why on
#     stderr (launchd captures it in the service log).
#   * a child that ran longer resets the counter, so ordinary page restarts and
#     long uptimes never trip it.
#
# Recover with: ${kickstart}
set -u
RAPID_FAILURE_WINDOW=${String(RAPID_FAILURE_WINDOW_SECONDS)}
RAPID_FAILURE_LIMIT=${String(RAPID_FAILURE_LIMIT)}
RESTART_DELAY=${String(RESTART_DELAY_SECONDS)}
child=0
forward() {
  if [ "$child" -gt 0 ]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap forward TERM INT HUP
rapid=0
while :; do
  started=$(date +%s)
  ${args} &
  child=$!
  wait "$child"
  code=$?
  child=0
  elapsed=$(( $(date +%s) - started ))
  if [ "$elapsed" -lt "$RAPID_FAILURE_WINDOW" ]; then
    rapid=$(( rapid + 1 ))
    echo "[dsh-update-status] supervisor: DSH exited with code $code after \${elapsed}s (rapid failure $rapid/$RAPID_FAILURE_LIMIT)" >&2
  else
    rapid=0
  fi
  if [ "$rapid" -ge "$RAPID_FAILURE_LIMIT" ]; then
    echo "[dsh-update-status] supervisor: giving up after $RAPID_FAILURE_LIMIT rapid failures (last exit code $code). Another process may hold the port; fix that, then run: ${kickstart}" >&2
    exit 78
  fi
  sleep "$RESTART_DELAY"
done
`
}

function launchdDefinition(spec: ServiceSpec, paths: ServicePaths): string {
  const wrapper = paths.wrapperFile
  if (wrapper === undefined) throw new Error('macOS service plan requires a supervisor wrapper path')
  const args = ['/bin/sh', wrapper].map(value => `    <string>${xml(value)}</string>`).join('\n')
  const env: ReadonlyArray<readonly [string, string]> = [
    ['HOME', spec.home],
    ['PATH', `${dirname(spec.nodePath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`],
    ['DSH_WEB_SUPERVISOR', spec.supervisorMarker],
    ...(spec.dshHome === undefined ? [] : [['DSH_HOME', spec.dshHome] as const]),
  ]
  const envXml = env.map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(spec.workspace)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(paths.stdoutFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(paths.stderrFile)}</string>
</dict>
</plist>
`
}

function systemdDefinition(spec: ServiceSpec): string {
  const command = [spec.nodePath, ...webArguments(spec)].map(value => `"${systemd(value)}"`).join(' ')
  const env = [
    `Environment="HOME=${systemd(spec.home)}"`,
    `Environment="PATH=${systemd(`${dirname(spec.nodePath)}:/usr/local/bin:/usr/bin:/bin`)}"`,
    `Environment="DSH_WEB_SUPERVISOR=${spec.supervisorMarker}"`,
    ...(spec.dshHome === undefined ? [] : [`Environment="DSH_HOME=${systemd(spec.dshHome)}"`]),
  ].join('\n')
  return `[Unit]
Description=DSH Web managed by dsh-update-status
After=network-online.target
# Bound the restart loop: without this, a port held by another launcher turns
# Restart=on-failure into an endless EADDRINUSE storm. Reset after fixing the
# cause with: systemctl --user reset-failed dsh-update-status-web.service
StartLimitIntervalSec=${String(SYSTEMD_START_LIMIT_INTERVAL_SECONDS)}
StartLimitBurst=${String(SYSTEMD_START_LIMIT_BURST)}

[Service]
Type=simple
WorkingDirectory="${systemd(spec.workspace)}"
${env}
ExecStart=${command}
Restart=on-failure
RestartSec=${String(RESTART_DELAY_SECONDS)}

[Install]
WantedBy=default.target
`
}

function windowsWrapper(spec: ServiceSpec, paths: ServicePaths): string {
  const node = powerShell(spec.nodePath)
  const dsh = powerShell(spec.dshPath)
  const workspace = powerShell(spec.workspace)
  const out = powerShell(paths.stdoutFile)
  const err = powerShell(paths.stderrFile)
  const home = powerShell(spec.home)
  const dshHome = spec.dshHome === undefined ? '' : `$env:DSH_HOME = '${powerShell(spec.dshHome)}'\n`
  return `$ErrorActionPreference = 'Stop'
$env:HOME = '${home}'
$env:DSH_WEB_SUPERVISOR = '${spec.supervisorMarker}'
${dshHome}Set-Location -LiteralPath '${workspace}'
$rapidWindowSeconds = ${String(RAPID_FAILURE_WINDOW_SECONDS)}
$rapidLimit = ${String(RAPID_FAILURE_LIMIT)}
$rapid = 0
while ($true) {
  $started = Get-Date
  & '${node}' '${dsh}' --profile '${powerShell(spec.profile)}' --host '${powerShell(spec.host)}' --port '${String(spec.port)}' --no-open 1>> '${out}' 2>> '${err}'
  $exitCode = $LASTEXITCODE
  $elapsed = ((Get-Date) - $started).TotalSeconds
  # A child that dies within the window never finished a boot; enough of them in a
  # row means another launcher owns the port, and respawning forever only spins.
  if ($elapsed -lt $rapidWindowSeconds) { $rapid = $rapid + 1 } else { $rapid = 0 }
  $note = "[dsh-update-status] supervisor: DSH exited with code $exitCode after $([int]$elapsed)s (rapid failure $rapid/$rapidLimit)"
  Write-Host $note
  # The service log is where a user looks; the console here is the task's own.
  Add-Content -LiteralPath '${err}' -Value $note -ErrorAction SilentlyContinue
  if ($rapid -ge $rapidLimit) {
    $note = "[dsh-update-status] supervisor: giving up after $rapidLimit rapid failures (last exit code $exitCode). Another process may hold the port; fix that, then re-run the scheduled task."
    Write-Host $note
    Add-Content -LiteralPath '${err}' -Value $note -ErrorAction SilentlyContinue
    exit 78
  }
  Start-Sleep -Seconds ${String(RESTART_DELAY_SECONDS)}
  # The user service owns deliberate restarts (exit 42) and unexpected exits.
  # Manual uninstall stops the scheduled task, which ends this wrapper.
}
`
}

function windowsDefinition(spec: ServiceSpec, paths: ServicePaths): string {
  const wrapper = paths.wrapperFile
  if (wrapper === undefined) throw new Error('Windows service plan requires a wrapper path')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>DSH Web managed by dsh-update-status</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -ExecutionPolicy Bypass -File &quot;${xml(wrapper)}&quot;</Arguments></Exec></Actions>
</Task>
`
}

/** Generate a service plan without writing, starting, or stopping anything. */
export function planFor(spec: ServiceSpec, uid: number = 0): ServicePlan {
  const paths = pathsFor(spec)
  if (spec.platform === 'darwin') {
    const domain = `gui/${uid}`
    return {
      spec, paths,
      definition: launchdDefinition(spec, paths),
      wrapper: launchdWrapper(spec, paths, uid),
      installCommand: ['launchctl', 'bootstrap', domain, paths.definitionFile],
      startCommand: ['launchctl', 'kickstart', '-k', `${domain}/${spec.label}`],
      recoverCommand: `launchctl kickstart -k ${domain}/${spec.label}`,
      statusCommand: ['launchctl', 'print', `${domain}/${spec.label}`],
      stopCommand: ['launchctl', 'bootout', `${domain}/${spec.label}`],
      uninstallCommand: ['launchctl', 'bootout', `${domain}/${spec.label}`],
    }
  }
  if (spec.platform === 'linux') return {
    spec, paths,
    definition: systemdDefinition(spec),
    installCommand: ['systemctl', '--user', 'daemon-reload'],
    startCommand: ['systemctl', '--user', 'enable', '--now', 'dsh-update-status-web.service'],
    // `reset-failed` first: the unit's own StartLimit is what stopped a storm.
    recoverCommand: `systemctl --user reset-failed ${SYSTEMD_UNIT} && systemctl --user enable --now ${SYSTEMD_UNIT}`,
    statusCommand: ['systemctl', '--user', 'status', 'dsh-update-status-web.service'],
    stopCommand: ['systemctl', '--user', 'disable', '--now', 'dsh-update-status-web.service'],
    uninstallCommand: ['systemctl', '--user', 'disable', '--now', 'dsh-update-status-web.service'],
  }
  return {
    spec, paths,
    definition: windowsDefinition(spec, paths),
    wrapper: windowsWrapper(spec, paths),
    installCommand: ['schtasks.exe', '/Create', '/TN', 'DSH Update Status Web', '/XML', paths.definitionFile, '/F'],
    startCommand: ['schtasks.exe', '/Run', '/TN', 'DSH Update Status Web'],
    recoverCommand: 'schtasks.exe /Run /TN "DSH Update Status Web"',
    statusCommand: ['schtasks.exe', '/Query', '/TN', 'DSH Update Status Web', '/V', '/FO', 'LIST'],
    stopCommand: ['schtasks.exe', '/End', '/TN', 'DSH Update Status Web'],
    uninstallCommand: ['schtasks.exe', '/Delete', '/TN', 'DSH Update Status Web', '/F'],
  }
}
