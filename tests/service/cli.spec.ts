import { createServer } from 'node:net'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../src/service/cli.ts'
import type { CliEnvironment, CommandRunner } from '../../src/service/types.ts'

const roots: string[] = []

const settled = async (): Promise<{ kind: 'settled' }> => ({ kind: 'settled' })

/** A port nobody holds, so activation's own port guard stays out of the way. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  if (address === null || typeof address === 'string') throw new Error('test listener missing')
  await new Promise<void>((resolve, reject) => probe.close(error => error === undefined ? resolve() : reject(error)))
  return address.port
}

function fixture(): { root: string; env: CliEnvironment; args: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'dus-service-cli-'))
  roots.push(root)
  const dsh = join(root, 'fake-dsh.mjs')
  writeFileSync(dsh, 'process.exit(0)\n', 'utf8')
  const env: CliEnvironment = {
    platform: 'darwin', home: root, cwd: root, execPath: process.execPath,
    uid: 501, path: process.env.PATH, env: {},
  }
  return {
    root, env,
    args: ['--workspace', root, '--dsh-home', join(root, '.dsh'), '--dsh', dsh],
  }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('explicit user-service CLI', () => {
  it('plans without writing files, preflighting, or running a native command', async () => {
    const { root, env, args } = fixture()
    let ran = 0
    let preflight = 0
    const run: CommandRunner = () => { ran += 1; return { status: 0, stdout: '', stderr: '' } }
    await expect(main(['plan', ...args, '--dry-run'], env, run, { preflight: () => { preflight += 1 } })).resolves.toBe(0)
    expect(ran).toBe(0)
    expect(preflight).toBe(0)
    expect(existsSync(join(root, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist'))).toBe(false)
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
    expect(existsSync(join(root, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist'))).toBe(true)
    await expect(main(['activate', ...isolatedArgs], env, run, { verify: settled })).resolves.toBe(0)
    expect(commands).toEqual([['launchctl', 'bootstrap', 'gui/501', join(root, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist')]])
    // The macOS definition runs under the staged wrapper, which owns the loop.
    expect(existsSync(join(root, '.dsh', 'dsh-update-status', 'dsh-web-supervisor.sh'))).toBe(true)
  })

  it('upgrades a definition it previously staged instead of refusing its own file', async () => {
    const { root, env, args } = fixture()
    const run: CommandRunner = () => ({ status: 0, stdout: '', stderr: '' })
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    const definition = join(root, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist')
    // An older generator's rendering differs from today's by exactly the fix being
    // installed, so ownership has to come from our receipt, not byte-equality.
    writeFileSync(definition, 'old launchd definition\n', 'utf8')
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    expect(readFileSync(definition, 'utf8')).toContain('<plist version="1.0">')
    expect(readFileSync(definition, 'utf8')).not.toContain('old launchd definition')
  })

  it('still refuses to overwrite a definition it never staged', async () => {
    const { root, env, args } = fixture()
    const run: CommandRunner = () => ({ status: 0, stdout: '', stderr: '' })
    const definition = join(root, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist')
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(0)
    writeFileSync(definition, 'someone else\n', 'utf8')
    // Without our receipt nothing proves we wrote this path.
    rmSync(join(root, '.dsh', 'dsh-update-status-service.json'), { force: true })
    await expect(main(['install', ...args], env, run, { preflight: () => {} })).resolves.toBe(1)
    expect(readFileSync(definition, 'utf8')).toBe('someone else\n')
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
