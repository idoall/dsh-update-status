/** Explicit, cross-platform user-service installer CLI. Never runs at plugin mount. */

import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
import { verifyActivatedService, type ServiceVerification } from './observe.ts'
import { nativeServiceCommandCandidates, nativeServiceCommandOf, pathsFor, planFor, SERVICE_LABEL, servicePlatform, serviceStateFileFromArgs, specFromArgs } from './plan.ts'
import { MAX_SERVICE_PATH_LENGTH, normalizeServicePathExt, servicePathOf } from './service-path.ts'
import type { CliEnvironment, CommandResult, CommandRunner, ServicePaths, ServicePlan, ServiceSpec } from './types.ts'

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
  --dsh <path>           Absolute dsh executable (default: resolve from profile)
  --log-dir <path>       Absolute log directory (default: $DSH_HOME/logs)
  --path-source <mode>   Service PATH source: current (default), minimal, explicit
  --service-path <value> Explicit PATH (implies --path-source explicit)
  --service-pathext <v>  Windows PATHEXT override (for example .COM;.EXE;.CMD)

current snapshots this command's PATH; it never executes your shell startup files.
The final PATH, source, capture time and warnings are stored in the receipt and
reused by preflight and every later service action.

Workflow: plan --dry-run → install → stop the terminal-started DSH yourself → activate.

activate refuses an occupied port, never kills a process, and then verifies that
the service it started actually took over; a service that begins crash-looping
makes activate fail instead of reporting success.
`
}

function assertSafeText(value: string, description: string): void {
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(value)) throw new Error(`${description} must not contain XML-illegal control characters or line breaks`)
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

function envValue(env: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  const match = Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())
  return match?.[1]
}

function validateSpec(spec: ServiceSpec, level: 'structural' | 'launch' = 'launch', expectedPlatform?: ServiceSpec['platform'], expectedHome?: string, expectedSystemRoot?: string): void {
  if (spec.schemaVersion !== 1) throw new Error('managed service receipt has an unsupported schema version')
  if (spec.platform !== 'darwin' && spec.platform !== 'linux' && spec.platform !== 'win32') throw new Error('managed service receipt has an invalid platform')
  if (expectedPlatform !== undefined && spec.platform !== expectedPlatform) throw new Error('managed service receipt belongs to a different platform')
  if (spec.label !== SERVICE_LABEL || spec.supervisorMarker !== 'dsh-update-status') throw new Error('managed service receipt has an unexpected service identity')
  if (expectedHome !== undefined && spec.home !== expectedHome) throw new Error('managed service receipt belongs to a different home directory')
  for (const [description, value] of [['profile', spec.profile], ['workspace', spec.workspace], ['home', spec.home], ['log directory', spec.logDir], ['host', spec.host], ['Node executable', spec.nodePath], ['dsh executable', spec.dshPath]] as const) {
    if (typeof value !== 'string') throw new Error(`managed service receipt has an invalid ${description}`)
    assertSafeText(value, description)
  }
  for (const [description, value] of [['workspace', spec.workspace], ['home', spec.home], ['log directory', spec.logDir], ['Node executable', spec.nodePath], ['dsh executable', spec.dshPath]] as const) {
    if (!isAbsolute(value)) throw new Error(`managed service receipt has a non-absolute ${description}`)
  }
  if (spec.dshHome !== undefined) {
    if (typeof spec.dshHome !== 'string') throw new Error('managed service receipt has an invalid DSH_HOME')
    assertSafeText(spec.dshHome, 'DSH_HOME')
    if (!isAbsolute(spec.dshHome)) throw new Error('managed service receipt has a non-absolute DSH_HOME')
  }
  if (!Number.isInteger(spec.port) || spec.port < 1 || spec.port > 65_535) throw new Error('managed service receipt has an invalid port')
  if (spec.servicePath !== undefined && typeof spec.servicePath !== 'string') throw new Error('managed service receipt has an invalid service PATH')
  if (spec.servicePathSource !== undefined && spec.servicePathSource !== 'current' && spec.servicePathSource !== 'minimal' && spec.servicePathSource !== 'explicit') throw new Error('managed service receipt has an invalid service PATH source')
  if (spec.servicePathCapturedAt !== undefined && (typeof spec.servicePathCapturedAt !== 'string' || Number.isNaN(Date.parse(spec.servicePathCapturedAt)))) throw new Error('managed service receipt has an invalid service PATH capture time')
  if (spec.servicePathExt !== undefined && typeof spec.servicePathExt !== 'string') throw new Error('managed service receipt has an invalid PATHEXT')
  if (spec.servicePathWarnings !== undefined && (!Array.isArray(spec.servicePathWarnings) || spec.servicePathWarnings.length > 256 || spec.servicePathWarnings.some(value => typeof value !== 'string'))) throw new Error('managed service receipt has invalid service PATH warnings')
  if (spec.servicePath === undefined && (spec.servicePathSource !== undefined || spec.servicePathCapturedAt !== undefined || spec.servicePathExt !== undefined || spec.servicePathWarnings !== undefined)) throw new Error('managed service receipt has PATH metadata without a service PATH')
  if (spec.servicePath !== undefined && (spec.servicePathSource === undefined || spec.servicePathCapturedAt === undefined)) throw new Error('managed service receipt has an incomplete service PATH record')
  if (spec.platform === 'win32' && spec.servicePath !== undefined && spec.servicePathExt === undefined) throw new Error('managed Windows service receipt has no PATHEXT')
  if (spec.platform !== 'win32' && spec.servicePathExt !== undefined) throw new Error('managed non-Windows service receipt has PATHEXT')
  if (spec.nativeServiceCommand !== undefined && typeof spec.nativeServiceCommand !== 'string') throw new Error('managed service receipt has an invalid native service command')
  const servicePath = servicePathOf(spec)
  assertSafeText(servicePath, 'service PATH')
  if (servicePath.length > MAX_SERVICE_PATH_LENGTH) throw new Error('managed service receipt has an overlong service PATH')
  if (spec.servicePathExt !== undefined) {
    assertSafeText(spec.servicePathExt, 'PATHEXT')
    if (spec.servicePathExt.length > MAX_SERVICE_PATH_LENGTH) throw new Error('managed service receipt has an overlong PATHEXT')
    normalizeServicePathExt(spec.servicePathExt)
  }
  for (const warning of spec.servicePathWarnings ?? []) assertSafeText(warning, 'service PATH warning')
  const nativeCommand = nativeServiceCommandOf(spec)
  assertSafeText(nativeCommand, 'native service command')
  if (!isAbsolute(nativeCommand)) throw new Error('managed service receipt has a non-absolute native service command')
  const allowedNativeCommands = nativeServiceCommandCandidates(spec.platform, expectedSystemRoot)
  const nativeKey = spec.platform === 'win32' ? nativeCommand.toLowerCase() : nativeCommand
  if (!allowedNativeCommands.some(candidate => (spec.platform === 'win32' ? candidate.toLowerCase() : candidate) === nativeKey)) throw new Error('managed service receipt has an unexpected native service command')
  if (spec.host !== '127.0.0.1' && spec.host !== '0.0.0.0') throw new Error('`--host` must be 127.0.0.1 or 0.0.0.0')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.profile)) throw new Error('`--profile` must contain only letters, numbers, dot, underscore, or hyphen')
  if (level === 'launch') {
    assertExecutable(spec.nodePath, 'Node executable')
    assertReadableRegular(spec.dshPath, 'dsh executable')
    assertExecutable(nativeCommand, 'Native service command')
    if (!existsSync(spec.workspace) || !statSync(spec.workspace).isDirectory()) throw new Error(`workspace is not a directory: ${spec.workspace}`)
  }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${String(process.pid)}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

/**
 * Replace an artifact only when we can prove we wrote it: either it already holds
 * exactly what we are about to write, or our own receipt names that path. The
 * receipt is what makes an upgrade possible at all — an improved definition
 * differs from the stored one by exactly the fix being installed, so
 * byte-equality with the previous rendering can never authorise it.
 */
function ensureReplaceable(path: string, expected: string, managed: boolean): void {
  if (!existsSync(path)) return
  let current: string
  try { current = readFileSync(path, 'utf8') } catch { throw new Error(`refusing to replace unreadable existing file: ${path}`) }
  if (current === expected || managed) return
  throw new Error(`refusing to overwrite an existing unmanaged service artifact: ${path}`)
}

function receiptOwnsPath(previous: Receipt | undefined, path: string): boolean {
  if (previous === undefined) return false
  const owned = pathsFor(previous.spec)
  return owned.definitionFile === path || owned.stateFile === path || owned.wrapperFile === path
}

function receiptTextOf(receipt: Receipt): string {
  return JSON.stringify(receipt, null, 2) + '\n'
}

function samePaths(left: ServicePaths, right: ServicePaths): boolean {
  return left.stateFile === right.stateFile && left.definitionFile === right.definitionFile
    && left.wrapperFile === right.wrapperFile && left.stdoutFile === right.stdoutFile && left.stderrFile === right.stderrFile
}

function readReceiptIfPresent(path: string, env: CliEnvironment): Receipt | undefined {
  return existsSync(path) ? readReceipt(path, env) : undefined
}

function readReceipt(path: string, env: CliEnvironment): Receipt {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<Receipt>
    if (value.version !== RECEIPT_VERSION || value.managedBy !== 'dsh-update-status' || value.spec === undefined || value.paths === undefined) {
      throw new Error('not a dsh-update-status service receipt')
    }
    validateSpec(value.spec, 'structural', servicePlatform(env.platform), env.home, envValue(env.env, 'SYSTEMROOT'))
    const canonical = pathsFor(value.spec)
    if (canonical.stateFile !== path || !samePaths(value.paths as ServicePaths, canonical)) throw new Error('managed service receipt paths do not match its service spec')
    return { version: RECEIPT_VERSION, managedBy: 'dsh-update-status', spec: value.spec, paths: canonical }
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

export function serialisePlan(plan: ServicePlan): string {
  const inheritedWindowsPath = plan.spec.platform === 'win32' && plan.spec.servicePath === undefined
  return JSON.stringify({
    platform: plan.spec.platform,
    label: plan.spec.label,
    nodePath: plan.spec.nodePath,
    dshPath: plan.spec.dshPath,
    profile: plan.spec.profile,
    workspace: plan.spec.workspace,
    host: plan.spec.host,
    port: plan.spec.port,
    nativeServiceCommand: nativeServiceCommandOf(plan.spec),
    servicePath: {
      source: inheritedWindowsPath ? 'inherited logon environment (legacy receipt)' : plan.spec.servicePathSource ?? 'minimal (legacy receipt)',
      value: inheritedWindowsPath ? null : servicePathOf(plan.spec),
      ...(plan.spec.servicePathCapturedAt === undefined ? {} : { capturedAt: plan.spec.servicePathCapturedAt }),
      ...(plan.spec.servicePathExt === undefined ? {} : { pathExt: plan.spec.servicePathExt }),
      warnings: plan.spec.servicePathWarnings ?? [],
    },
    definitionFile: plan.paths.definitionFile,
    wrapperFile: plan.paths.wrapperFile,
    stateFile: plan.paths.stateFile,
    logs: { stdout: plan.paths.stdoutFile, stderr: plan.paths.stderrFile },
    commands: { install: plan.installCommand, start: plan.startCommand, status: plan.statusCommand, stop: plan.stopCommand, uninstall: plan.uninstallCommand, recover: plan.recoverCommand },
  }, null, 2) + '\n'
}

function commandsForActivate(plan: ServicePlan, _uid: number): ReadonlyArray<readonly string[]> {
  if (plan.spec.platform === 'darwin') return [plan.installCommand]
  return [plan.installCommand, plan.startCommand]
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
      // Exact parity with the staged service: a boot-free green light must mean
      // the real service sees the same command lookup environment.
      PATH: servicePathOf(spec),
      ...(spec.platform === 'win32' && spec.servicePathExt !== undefined ? { PATHEXT: spec.servicePathExt } : {}),
    },
  })
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || result.error?.message || 'no diagnostic').trim().slice(0, 800)
    throw new Error(`DSH boot-free preflight failed; no service definition was written: ${diagnostic}`)
  }
}

export interface CliHooks {
  readonly preflight?: (spec: ServiceSpec) => void
  /** Injected in tests; defaults to the real post-activation verification. */
  readonly verify?: (spec: ServiceSpec) => Promise<ServiceVerification>
}

const VALUE_OPTIONS = new Set([
  '--profile', '--workspace', '--dsh-home', '--host', '--port', '--node', '--dsh', '--log-dir',
  '--path-source', '--service-path', '--service-pathext',
])

function assertKnownOptions(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!
    if (value === '--dry-run') continue
    if (!VALUE_OPTIONS.has(value)) throw new Error(`unknown option: ${value}`)
    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`missing value after ${value}`)
    index += 1
  }
}

function warnAboutPath(spec: ServiceSpec): void {
  for (const warning of spec.servicePathWarnings ?? []) process.stderr.write(`Warning: ${warning}\n`)
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
  try {
    assertKnownOptions(rawArgs)
  } catch (error) {
    process.stderr.write(`dsh-update-status-service: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  const dryRun = rawArgs.includes('--dry-run') || action === 'plan'
  const args = rawArgs.filter(value => value !== '--dry-run')
  try {
    if (dryRun || action === 'install') {
      const spec = specFromArgs(args, env)
      validateSpec(spec, 'launch', servicePlatform(env.platform), env.home, envValue(env.env, 'SYSTEMROOT'))
      const plan = planFor(spec, env.uid ?? 0)
      if (dryRun) {
        process.stdout.write(serialisePlan(plan))
        return 0
      }
      process.stdout.write(`Service PATH (${spec.servicePathSource ?? 'minimal'}): ${servicePathOf(spec)}\n`)
      warnAboutPath(spec)
      ;(hooks.preflight ?? preflight)(spec)
      const previous = readReceiptIfPresent(plan.paths.stateFile, env)
      ensureReplaceable(plan.paths.definitionFile, plan.definition, receiptOwnsPath(previous, plan.paths.definitionFile))
      if (plan.wrapper !== undefined && plan.paths.wrapperFile !== undefined) {
        ensureReplaceable(plan.paths.wrapperFile, plan.wrapper, receiptOwnsPath(previous, plan.paths.wrapperFile))
      }
      const receipt: Receipt = { version: RECEIPT_VERSION, managedBy: 'dsh-update-status', spec, paths: plan.paths }
      const receiptText = receiptTextOf(receipt)
      ensureReplaceable(plan.paths.stateFile, receiptText, receiptOwnsPath(previous, plan.paths.stateFile))
      mkdirSync(spec.logDir, { recursive: true, mode: 0o700 })
      atomicWrite(plan.paths.definitionFile, plan.definition)
      if (plan.wrapper !== undefined && plan.paths.wrapperFile !== undefined) atomicWrite(plan.paths.wrapperFile, plan.wrapper)
      atomicWrite(plan.paths.stateFile, receiptText)
      process.stdout.write(`Staged user service definition: ${plan.paths.definitionFile}\nNo service has started. Stop your terminal-started DSH, then run activate.\n`)
      return 0
    }

    // Locate the receipt from DSH_HOME alone — no current PATH, profile package,
    // workspace or Node resolution can block status/activate/stop/uninstall.
    const receipt = readReceipt(serviceStateFileFromArgs(args, env), env)
    const plan = planFor(receipt.spec, env.uid ?? 0)
    // Starting DSH needs its launch facts; status/stop/uninstall must still work
    // after a Node upgrade or workspace deletion so the broken service is removable.
    if (action === 'activate') validateSpec(receipt.spec, 'launch', servicePlatform(env.platform), env.home, envValue(env.env, 'SYSTEMROOT'))
    if (action === 'activate') {
      if (!await portIsFree(receipt.spec.host, receipt.spec.port)) {
        throw new Error(`port ${receipt.spec.host}:${String(receipt.spec.port)} is in use; stop the existing DSH yourself before activate. Nothing was killed.`)
      }
      for (const command of commandsForActivate(plan, env.uid ?? 0)) invoke(command, run)
      const verify = hooks.verify ?? ((installed: ServiceSpec) => verifyActivatedService(installed, { run, uid: env.uid ?? 0 }))
      const verification = await verify(receipt.spec)
      if (verification.kind === 'crash-loop') {
        throw new Error(`the activated service is restarting repeatedly (${String(verification.recentRestarts)} starts within ${String(Math.round(verification.windowMs / 1000))}s); another process probably holds ${receipt.spec.host}:${String(receipt.spec.port)}. Nothing was killed. Stop that instance, fix the cause, then run activate again.`)
      }
      if (verification.kind === 'not-running') {
        throw new Error(`the activated service reported no running process; check the native status and the logs in ${receipt.spec.logDir}. Nothing was killed.`)
      }
      process.stdout.write('User service activated and verified to be running. Wait for DSH to become ready, then open the existing Web URL.\n')
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
    // uninstall: stop first, then remove only canonical paths re-derived from the
    // validated spec — never deletion targets supplied by a mutable receipt.
    const result = run(plan.uninstallCommand[0]!, plan.uninstallCommand.slice(1))
    // A not-yet-loaded unit/task can return nonzero. Its definition is still
    // safe to remove because receipt ownership was verified above.
    if (result.status !== 0) process.stderr.write(`Warning: ${result.stderr || result.stdout || 'service was not loaded'}\n`)
    rmSync(plan.paths.definitionFile, { force: true })
    if (plan.paths.wrapperFile !== undefined) rmSync(plan.paths.wrapperFile, { force: true })
    rmSync(plan.paths.stateFile, { force: true })
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
