/** Explicit, cross-platform user-service installer CLI. Never runs at plugin mount. */

import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathsFor, planFor, specFromArgs } from './plan.ts'
import type { CliEnvironment, CommandResult, CommandRunner, ServicePlan, ServiceSpec } from './types.ts'

const RECEIPT_VERSION = 1

interface Receipt {
  readonly version: 1
  readonly managedBy: 'dsh-update-status'
  readonly spec: ServiceSpec
  readonly paths: ReturnType<typeof pathsFor>
}

function environment(): CliEnvironment {
  return {
    platform: process.platform,
    home: process.env.HOME ?? process.env.USERPROFILE ?? '',
    cwd: process.cwd(), execPath: process.execPath,
    env: process.env, path: process.env.PATH,
    ...(typeof process.getuid === 'function' ? { uid: process.getuid() } : {}),
  }
}

function runner(file: string, args: readonly string[]): CommandResult {
  const result = spawnSync(file, [...args], { encoding: 'utf8', windowsHide: true })
  return {
    status: result.status,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error.message }),
  }
}

function usage(): string {
  return `Usage: dsh-update-status-service <plan|install|activate|status|stop|uninstall> [options]

Create a current-user DSH Web supervisor. This CLI never runs automatically.

Options:
  --dry-run              Print the expanded plan without writing or invoking OS services
  --profile <name>       DSH profile (default: DSH_PROFILE or web)
  --workspace <path>     Required absolute working directory for DSH
  --dsh-home <path>      Optional absolute DSH home (default: DSH_HOME or ~/.dsh)
  --host <127.0.0.1|0.0.0.0>  Bind host (default: 127.0.0.1)
  --port <1..65535>      Web port (default: 3080)
  --node <path>          Absolute Node executable (default: current Node)
  --dsh <path>           Absolute dsh executable (default: resolve from PATH)
  --log-dir <path>       Absolute log directory (default: $DSH_HOME/logs)

Workflow: plan --dry-run → install → stop the terminal-started DSH yourself → activate.
`
}

function assertSafeText(value: string, description: string): void {
  if (/[\u0000\r\n]/.test(value)) throw new Error(`${description} must not contain NUL or line breaks`)
}

function assertReadableRegular(path: string, description: string): void {
  assertSafeText(path, description)
  if (!existsSync(path)) throw new Error(`${description} does not exist: ${path}`)
  try {
    if (!statSync(path).isFile()) throw new Error(`${description} is not a regular file: ${path}`)
    accessSync(path, constants.R_OK)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(description)) throw error
    throw new Error(`${description} is not readable: ${path}`)
  }
}

function assertExecutable(path: string, description: string): void {
  assertReadableRegular(path, description)
  if (process.platform !== 'win32') {
    try { accessSync(path, constants.X_OK) } catch { throw new Error(`${description} is not executable: ${path}`) }
  }
}

function validateSpec(spec: ServiceSpec): void {
  for (const [description, value] of [['profile', spec.profile], ['workspace', spec.workspace], ['home', spec.home], ['log directory', spec.logDir], ['host', spec.host]] as const) assertSafeText(value, description)
  if (spec.host !== '127.0.0.1' && spec.host !== '0.0.0.0') throw new Error('`--host` must be 127.0.0.1 or 0.0.0.0')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.profile)) throw new Error('`--profile` must contain only letters, numbers, dot, underscore, or hyphen')
  assertExecutable(spec.nodePath, 'Node executable')
  assertReadableRegular(spec.dshPath, 'dsh executable')
  assertSafeText(spec.workspace, 'workspace')
  if (!existsSync(spec.workspace) || !statSync(spec.workspace).isDirectory()) throw new Error(`workspace is not a directory: ${spec.workspace}`)
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${String(process.pid)}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

function ensureManagedTarget(path: string, expected: string): void {
  if (!existsSync(path)) return
  let current: string
  try { current = readFileSync(path, 'utf8') } catch { throw new Error(`refusing to replace unreadable existing file: ${path}`) }
  if (current !== expected) throw new Error(`refusing to overwrite an existing unmanaged service artifact: ${path}`)
}

function readReceipt(path: string): Receipt {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<Receipt>
    if (value.version !== RECEIPT_VERSION || value.managedBy !== 'dsh-update-status' || value.spec === undefined || value.paths === undefined) {
      throw new Error('not a dsh-update-status service receipt')
    }
    return value as Receipt
  } catch (error) {
    throw new Error(`cannot read managed service receipt ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function portIsFree(host: string, port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => server.close(error => resolve(error === undefined)))
  })
}

function serialisePlan(plan: ServicePlan): string {
  return JSON.stringify({
    platform: plan.spec.platform,
    label: plan.spec.label,
    nodePath: plan.spec.nodePath,
    dshPath: plan.spec.dshPath,
    profile: plan.spec.profile,
    workspace: plan.spec.workspace,
    host: plan.spec.host,
    port: plan.spec.port,
    definitionFile: plan.paths.definitionFile,
    wrapperFile: plan.paths.wrapperFile,
    stateFile: plan.paths.stateFile,
    logs: { stdout: plan.paths.stdoutFile, stderr: plan.paths.stderrFile },
    commands: { install: plan.installCommand, start: plan.startCommand, status: plan.statusCommand, stop: plan.stopCommand, uninstall: plan.uninstallCommand },
  }, null, 2) + '\n'
}

function commandsForActivate(plan: ServicePlan, uid: number): ReadonlyArray<readonly string[]> {
  if (plan.spec.platform === 'darwin') return [['launchctl', 'bootstrap', `gui/${uid}`, plan.paths.definitionFile]]
  if (plan.spec.platform === 'linux') return [
    ['systemctl', '--user', 'daemon-reload'],
    ['systemctl', '--user', 'enable', '--now', 'dsh-update-status-web.service'],
  ]
  return [
    ['schtasks.exe', '/Create', '/TN', 'DSH Update Status Web', '/XML', plan.paths.definitionFile, '/F'],
    ['schtasks.exe', '/Run', '/TN', 'DSH Update Status Web'],
  ]
}

function invoke(command: readonly string[], run: CommandRunner): void {
  const [file, ...args] = command
  if (file === undefined) throw new Error('empty service command')
  const result = run(file, args)
  if (result.status !== 0) throw new Error(`${command.join(' ')} failed (${String(result.status)}): ${(result.stderr || result.stdout || result.error || 'no diagnostic').trim()}`)
}

function preflight(spec: ServiceSpec): void {
  const result = spawnSync(spec.nodePath, [spec.dshPath, '--profile', spec.profile, '--dump-config'], {
    cwd: spec.workspace,
    encoding: 'utf8',
    timeout: 90_000,
    windowsHide: true,
    env: {
      HOME: spec.home,
      ...(spec.dshHome === undefined ? {} : { DSH_HOME: spec.dshHome }),
      PATH: `${dirname(spec.nodePath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    },
  })
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || result.error?.message || 'no diagnostic').trim().slice(0, 800)
    throw new Error(`DSH boot-free preflight failed; no service definition was written: ${diagnostic}`)
  }
}

export interface CliHooks {
  readonly preflight?: (spec: ServiceSpec) => void
}

export async function main(argv: readonly string[] = process.argv.slice(2), env = environment(), run: CommandRunner = runner, hooks: CliHooks = {}): Promise<number> {
  const [action, ...rawArgs] = argv
  if (action === undefined || action === '--help' || action === '-h') {
    process.stdout.write(usage())
    return action === undefined ? 2 : 0
  }
  if (!['plan', 'install', 'activate', 'status', 'stop', 'uninstall'].includes(action)) {
    process.stderr.write(`Unknown command: ${action}\n${usage()}`)
    return 2
  }
  const dryRun = rawArgs.includes('--dry-run') || action === 'plan'
  const args = rawArgs.filter(value => value !== '--dry-run')
  try {
    const spec = specFromArgs(args, env)
    validateSpec(spec)
    const plan = planFor(spec, env.uid ?? 0)
    if (dryRun) {
      process.stdout.write(serialisePlan(plan))
      return 0
    }
    if (action === 'install') {
      ;(hooks.preflight ?? preflight)(spec)
      ensureManagedTarget(plan.paths.definitionFile, plan.definition)
      if (plan.wrapper !== undefined && plan.paths.wrapperFile !== undefined) ensureManagedTarget(plan.paths.wrapperFile, plan.wrapper)
      const receipt: Receipt = { version: RECEIPT_VERSION, managedBy: 'dsh-update-status', spec, paths: plan.paths }
      const receiptText = JSON.stringify(receipt, null, 2) + '\n'
      ensureManagedTarget(plan.paths.stateFile, receiptText)
      mkdirSync(spec.logDir, { recursive: true, mode: 0o700 })
      atomicWrite(plan.paths.definitionFile, plan.definition)
      if (plan.wrapper !== undefined && plan.paths.wrapperFile !== undefined) atomicWrite(plan.paths.wrapperFile, plan.wrapper)
      atomicWrite(plan.paths.stateFile, receiptText)
      process.stdout.write(`Staged user service definition: ${plan.paths.definitionFile}\nNo service has started. Stop your terminal-started DSH, then run activate.\n`)
      return 0
    }
    const receipt = readReceipt(plan.paths.stateFile)
    if (action === 'activate') {
      if (!await portIsFree(receipt.spec.host, receipt.spec.port)) {
        throw new Error(`port ${receipt.spec.host}:${String(receipt.spec.port)} is in use; stop the existing DSH yourself before activate. Nothing was killed.`)
      }
      for (const command of commandsForActivate(plan, env.uid ?? 0)) invoke(command, run)
      process.stdout.write('User service activated. Wait for DSH to become ready, then open the existing Web URL.\n')
      return 0
    }
    if (action === 'status') {
      const result = run(plan.statusCommand[0]!, plan.statusCommand.slice(1))
      process.stdout.write(serialisePlan(plan))
      process.stdout.write(`Native status (${plan.statusCommand.join(' ')}):\n${result.stdout || result.stderr || result.error || `exit ${String(result.status)}`}\n`)
      return result.status === 0 ? 0 : 1
    }
    if (action === 'stop') {
      invoke(plan.stopCommand, run)
      process.stdout.write('User service stopped. Its definition and receipt remain; run activate to start it again.\n')
      return 0
    }
    // uninstall: stop first, then remove only the paths named by our receipt.
    const result = run(plan.uninstallCommand[0]!, plan.uninstallCommand.slice(1))
    // A not-yet-loaded unit/task can return nonzero. Its definition is still
    // safe to remove because receipt ownership was verified above.
    if (result.status !== 0) process.stderr.write(`Warning: ${result.stderr || result.stdout || 'service was not loaded'}\n`)
    rmSync(receipt.paths.definitionFile, { force: true })
    if (receipt.paths.wrapperFile !== undefined) rmSync(receipt.paths.wrapperFile, { force: true })
    rmSync(receipt.paths.stateFile, { force: true })
    process.stdout.write('Removed the managed user-service definition. Logs were preserved.\n')
    return 0
  } catch (error) {
    process.stderr.write(`dsh-update-status-service: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  void main().then(code => { process.exitCode = code })
}
