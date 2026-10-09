import { createServer } from 'node:net'
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../../src/service/cli.ts'
import type { CliEnvironment, CommandRunner, ServicePlatform } from '../../src/service/types.ts'

const roots: string[] = []

const settled = async (): Promise<{ kind: 'settled' }> => ({ kind: 'settled' })

const PATH_DELIMITER = process.platform === 'win32' ? ';' : ':'

function pathValue(...entries: string[]): string {
  return entries.join(PATH_DELIMITER)
}

function withoutPathFlags(args: readonly string[]): string[] {
  const clean: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--path-source' || args[index] === '--service-path') { index += 1; continue }
    clean.push(args[index]!)
  }
  return clean
}

/** A port nobody holds, so activation's own port guard stays out of the way. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  if (address === null || typeof address === 'string') throw new Error('test listener missing')
  await new Promise<void>((resolve, reject) => probe.close(error => error === undefined ? resolve() : reject(error)))
  return address.port
}

function platformOf(): ServicePlatform {
  if (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32') return process.platform
  throw new Error(`unsupported test platform: ${process.platform}`)
}

function definitionPath(root: string, platform: ServicePlatform): string {
  if (platform === 'darwin') return join(root, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist')
  if (platform === 'linux') return join(root, '.config', 'systemd', 'user', 'dsh-update-status-web.service')
  return join(root, 'AppData', 'Local', 'dsh-update-status', 'dsh-web-task.xml')
}

function wrapperPath(root: string, platform: ServicePlatform): string | undefined {
  if (platform === 'darwin') return join(root, '.dsh', 'dsh-update-status', 'dsh-web-supervisor.sh')
  if (platform === 'win32') return join(root, 'AppData', 'Local', 'dsh-update-status', 'dsh-web-supervisor.ps1')
  return undefined
}

function pathArtifact(root: string, platform: ServicePlatform): string {
  return platform === 'win32' ? wrapperPath(root, platform)! : definitionPath(root, platform)
}

function expectedPathText(value: string, platform: ServicePlatform): string {
  if (platform === 'darwin') return `<string>${value}</string>`
  if (platform === 'linux') return `Environment="PATH=${value}"`
  return `$env:PATH = '${value.replace(/'/g, "''")}'`
}

function expectedActivation(root: string, platform: ServicePlatform): string[][] {
  const definition = definitionPath(root, platform)
  if (platform === 'darwin') return [['/bin/launchctl', 'bootstrap', 'gui/501', definition]]
  if (platform === 'linux') return [
    ['/usr/bin/systemctl', '--user', 'daemon-reload'],
    ['/usr/bin/systemctl', '--user', 'enable', '--now', 'dsh-update-status-web.service'],
  ]
  return [
    ['C:\\Windows\\System32\\schtasks.exe', '/Create', '/TN', 'DSH Update Status Web', '/XML', definition, '/F'],
    ['C:\\Windows\\System32\\schtasks.exe', '/Run', '/TN', 'DSH Update Status Web'],
  ]
}

function fixture(): { root: string; env: CliEnvironment; args: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'dus-service-cli-'))
  roots.push(root)
  const dsh = join(root, 'fake-dsh.mjs')
  writeFileSync(dsh, 'process.exit(0)\n', 'utf8')
  const env: CliEnvironment = {
    platform: process.platform, home: root, cwd: root, execPath: process.execPath,
    uid: 501, path: process.env.PATH, env: process.env,
  }
  return {
    root, env,
    // These integration tests exercise CLI lifecycle, not the host runner's PATH.
    // Pure PATH-source behaviour is locked in service-path.spec.ts.
    args: ['--workspace', root, '--dsh-home', join(root, '.dsh'), '--dsh', dsh, '--path-source', 'minimal'],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('explicit user-service CLI', () => {
  it('plans without writing files, preflighting, or running a native command', async () => {
    const { root, env, args } = fixture()
    let ran = 0
    let preflight = 0
    const run: CommandRunner = () => { ran += 1; return { status: 0, stdout: '', stderr: '' } }
    await expect(main(['plan', ...args, '--dry-run'], env, run, { preflight: () => { preflight += 1 } })).resolves.toBe(0)
    expect(ran).toBe(0)
    expect(preflight).toBe(0)
    expect(existsSync(definitionPath(root, platformOf()))).toBe(false)
  })

  it('prints the final PATH and warnings in dry-run output', async () => {
    const { root, env, args } = fixture()
    const future = join(root, 'future-bin')
    const current = pathValue(dirname(process.execPath), root, future)
    const currentEnv: CliEnvironment = { ...env, path: current }
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(((value: string | Uint8Array) => { output += String(value); return true }) as typeof process.stdout.write)
    await expect(main(['plan', ...withoutPathFlags(args)], currentEnv, () => ({ status: 0, stdout: '', stderr: '' }))).resolves.toBe(0)
    const parsed = JSON.parse(output) as { servicePath: { source: string; value: string; capturedAt: string; warnings: string[] } }
    expect(parsed.servicePath.source).toBe('current')
    expect(parsed.servicePath.value).toBe(current)
    expect(parsed.servicePath.capturedAt).toMatch(/^\d{4}-/)
    expect(parsed.servicePath.warnings).toEqual([`PATH directory does not exist yet: ${future}`])
  })

  it('runs the real preflight with exactly the PATH written to the definition and receipt', async () => {
    const { root, env, args } = fixture()
    const bin = join(root, 'custom tools')
    mkdirSync(bin)
    const recorded = join(root, 'preflight-path.txt')
    const dsh = args[args.indexOf('--dsh') + 1]!
    writeFileSync(dsh, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(recorded)}, process.env.PATH ?? '')\n`, 'utf8')
    const current = process.platform === 'win32'
      ? pathValue(dirname(process.execPath), bin, 'C:\\Windows\\System32', 'C:\\Windows')
      : pathValue(dirname(process.execPath), bin, '/usr/bin', '/bin')
    const installEnv: CliEnvironment = { ...env, path: current }
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(((value: string | Uint8Array) => { output += String(value); return true }) as typeof process.stdout.write)
    await expect(main(['install', ...withoutPathFlags(args)], installEnv, () => ({ status: 0, stdout: '', stderr: '' }))).resolves.toBe(0)
    expect(output).toContain(`Service PATH (current): ${current}`)
    expect(readFileSync(recorded, 'utf8')).toBe(current)
    const receipt = JSON.parse(readFileSync(join(root, '.dsh', 'dsh-update-status-service.json'), 'utf8')) as { spec: { servicePath: string } }
    expect(receipt.spec.servicePath).toBe(current)
    expect(readFileSync(pathArtifact(root, platformOf()), 'utf8')).toContain(expectedPathText(current, platformOf()))
  })

  it('persists one PATH for preflight and later actions instead of recapturing it', async () => {
    const { root, env, args } = fixture()
    const current = pathValue(dirname(process.execPath), root)
    const installEnv: CliEnvironment = { ...env, path: current }
    let preflightPath = ''
    await expect(main(['install', ...withoutPathFlags(args)], installEnv, () => ({ status: 0, stdout: '', stderr: '' }), {
      preflight: spec => { preflightPath = spec.servicePath ?? '' },
    })).resolves.toBe(0)
    const receipt = JSON.parse(readFileSync(join(root, '.dsh', 'dsh-update-status-service.json'), 'utf8')) as { spec: { servicePath: string; servicePathSource: string } }
    expect(preflightPath).toBe(current)
    expect(receipt.spec).toMatchObject({ servicePath: current, servicePathSource: 'current' })
    // Activate from an unrelated environment. The receipt, not this PATH, is the source of truth.
    const unrelated: CliEnvironment = { ...env, path: process.platform === 'win32' ? 'D:\\different\\terminal\\path' : '/different/terminal/path' }
    const free = await freePort()
    // Port is part of the persisted receipt; rewrite only that fixture before activation.
    const path = join(root, '.dsh', 'dsh-update-status-service.json')
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { spec: { port: number } }
    saved.spec.port = free
    writeFileSync(path, JSON.stringify(saved, null, 2) + '\n')
    // No workspace/profile/PATH is needed after install; the receipt is the source of truth.
    await expect(main(['activate', '--dsh-home', join(root, '.dsh')], unrelated, () => ({ status: 0, stdout: '', stderr: '' }), { verify: settled })).resolves.toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8')).spec.servicePath).toBe(current)
  })

  it('stages only after injected preflight, then activates through a native command runner', async () => {
    const { root, env, args } = fixture()
    const probe = createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('test listener missing')
    const isolatedArgs = [...args, '--port', String(address.port)]
    await new Promise<void>((resolve, reject) => probe.close(error => error === undefined ? resolve() : reject(error)))
    const commands: string[][] = []
    const run: CommandRunner = (file, commandArgs) => { commands.push([file, ...commandArgs]); return { status: 0, stdout: '', stderr: '' } }
    let preflight = 0
    await expect(main(['install', ...isolatedArgs], env, run, { preflight: () => { preflight += 1 } })).resolves.toBe(0)
    expect(preflight).toBe(1)
    expect(commands).toEqual([])
    expect(existsSync(definitionPath(root, platformOf()))).toBe(true)
    await expect(main(['activate', ...isolatedArgs], env, run, { verify: settled })).resolves.toBe(0)
    expect(commands).toEqual(expectedActivation(root, platformOf()))
    const wrapper = wrapperPath(root, platformOf())
    if (wrapper !== undefined) expect(existsSync(wrapper)).toBe(true)
  })

  it('upgrades a definition it previously staged instead of refusing its own file', async () => {
    const { root, env, args } = fixture()
    const run: CommandRunner = () => ({ status: 0, stdout: '', stderr: '' })
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    const definition = definitionPath(root, platformOf())
    // An older generator's rendering differs from today's by exactly the fix being
    // installed, so ownership has to come from our receipt, not byte-equality.
    writeFileSync(definition, 'old launchd definition\n', 'utf8')
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    const marker = platformOf() === 'linux' ? '[Unit]' : platformOf() === 'win32' ? '<Task version="1.4"' : '<plist version="1.0">'
    expect(readFileSync(definition, 'utf8')).toContain(marker)
    expect(readFileSync(definition, 'utf8')).not.toContain('old launchd definition')
  })

  it('rejects a tampered receipt before it can authorise overwrite or delete arbitrary files', async () => {
    const { root, env, args } = fixture()
    const run: CommandRunner = () => ({ status: 0, stdout: '', stderr: '' })
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    const receiptPath = join(root, '.dsh', 'dsh-update-status-service.json')
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { paths: Record<string, unknown> }
    const victim = join(root, 'keep-me.txt')
    writeFileSync(victim, 'safe', 'utf8')
    receipt.paths.definitionFile = victim
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
    await expect(main(['uninstall', '--dsh-home', join(root, '.dsh')], env, run)).resolves.toBe(1)
    expect(readFileSync(victim, 'utf8')).toBe('safe')
  })

  it('rejects a receipt that nominates a different native command or malformed DSH_HOME', async () => {
    const { root, env, args } = fixture()
    let ran = 0
    const run: CommandRunner = () => { ran += 1; return { status: 0, stdout: '', stderr: '' } }
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    const receiptPath = join(root, '.dsh', 'dsh-update-status-service.json')
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { spec: Record<string, unknown> }
    receipt.spec.nativeServiceCommand = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/rm'
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
    await expect(main(['status', '--dsh-home', join(root, '.dsh')], env, run)).resolves.toBe(1)
    expect(ran).toBe(0)
    receipt.spec.nativeServiceCommand = platformOf() === 'darwin' ? '/bin/launchctl'
      : platformOf() === 'linux' ? '/usr/bin/systemctl' : 'C:\\Windows\\System32\\schtasks.exe'
    receipt.spec.dshHome = `${join(root, '.dsh')}\u0001`
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
    await expect(main(['status', '--dsh-home', join(root, '.dsh')], env, run)).resolves.toBe(1)
    expect(ran).toBe(0)
  })

  it('lets stop, status and uninstall work after Node/DSH/workspace disappear, but refuses activate', async () => {
    const { root, env, args } = fixture()
    const nativeCommands: string[] = []
    const run: CommandRunner = file => { nativeCommands.push(file); return { status: 0, stdout: 'ok', stderr: '' } }
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    const receiptPath = join(root, '.dsh', 'dsh-update-status-service.json')
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { spec: Record<string, unknown> }
    receipt.spec.nodePath = join(root, 'gone-node')
    receipt.spec.dshPath = join(root, 'gone-dsh')
    receipt.spec.workspace = join(root, 'gone-workspace')
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
    await expect(main(['status', '--dsh-home', join(root, '.dsh')], env, run)).resolves.toBe(0)
    await expect(main(['stop', '--dsh-home', join(root, '.dsh')], env, run)).resolves.toBe(0)
    await expect(main(['activate', '--dsh-home', join(root, '.dsh')], env, run, { verify: settled })).resolves.toBe(1)
    await expect(main(['uninstall', '--dsh-home', join(root, '.dsh')], env, run)).resolves.toBe(0)
    expect(nativeCommands.length).toBeGreaterThan(0)
    expect(nativeCommands.every(file => isAbsolute(file))).toBe(true)
  })

  it('rejects unknown options instead of silently looking up the default receipt', async () => {
    const { env } = fixture()
    await expect(main(['status', '--dsh-hmoe', '/typo'], env, () => ({ status: 0, stdout: '', stderr: '' }))).resolves.toBe(2)
  })

  it('still refuses to overwrite a definition it never staged', async () => {
    const { root, env, args } = fixture()
    const run: CommandRunner = () => ({ status: 0, stdout: '', stderr: '' })
    const definition = definitionPath(root, platformOf())
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    writeFileSync(definition, 'someone else\n', 'utf8')
    // Without our receipt nothing proves we wrote this path.
    rmSync(join(root, '.dsh', 'dsh-update-status-service.json'), { force: true })
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(1)
    expect(readFileSync(definition, 'utf8')).toBe('someone else\n')
  })

  it('refuses corrupted PATH metadata in a managed receipt', async () => {
    const { root, env, args } = fixture()
    await expect(main(['install', ...args], env, () => ({ status: 0, stdout: '', stderr: '' }), { preflight: () => {} })).resolves.toBe(0)
    const path = join(root, '.dsh', 'dsh-update-status-service.json')
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { spec: Record<string, unknown> }
    saved.spec.servicePathWarnings = 'not-an-array'
    writeFileSync(path, JSON.stringify(saved, null, 2) + '\n')
    await expect(main(['status', '--dsh-home', join(root, '.dsh')], env, () => ({ status: 0, stdout: '', stderr: '' }))).resolves.toBe(1)
    saved.spec.servicePathWarnings = []
    saved.spec.servicePath = `/${'x'.repeat(9_000)}`
    writeFileSync(path, JSON.stringify(saved, null, 2) + '\n')
    await expect(main(['status', '--dsh-home', join(root, '.dsh')], env, () => ({ status: 0, stdout: '', stderr: '' }))).resolves.toBe(1)
  })

  it('fails activation instead of claiming success when the service crash-loops', async () => {
    const { env, args } = fixture()
    const run: CommandRunner = () => ({ status: 0, stdout: '', stderr: '' })
    const free = await freePort()
    const isolated = [...args, '--port', String(free)]
    await expect(main(['install', ...isolated], env, run, { preflight: () => {} })).resolves.toBe(0)
    await expect(main(['activate', ...isolated], env, run, {
      verify: async () => ({ kind: 'crash-loop', recentRestarts: 18, windowMs: 180_000 }),
    })).resolves.toBe(1)
    await expect(main(['activate', ...isolated], env, run, {
      verify: async () => ({ kind: 'not-running' }),
    })).resolves.toBe(1)
  })

  it('refuses activation while the requested port belongs to another process', async () => {
    const { env, args } = fixture()
    let ran = 0
    const run: CommandRunner = () => { ran += 1; return { status: 0, stdout: '', stderr: '' } }
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test listener missing')
    const occupiedArgs = [...args, '--port', String(address.port)]
    // Staging is allowed; activation alone proves that it will never seize a live port.
    await expect(main(['install', ...occupiedArgs], env, run, { preflight: () => {} })).resolves.toBe(0)
    await expect(main(['activate', ...occupiedArgs], env, run)).resolves.toBe(1)
    expect(ran).toBe(0)
    await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  })
})
