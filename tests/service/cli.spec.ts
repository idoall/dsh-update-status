import { createServer } from 'node:net'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../src/service/cli.ts'
import type { CliEnvironment, CommandRunner } from '../../src/service/types.ts'

const roots: string[] = []

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
    await expect(main(['activate', ...isolatedArgs], env, run)).resolves.toBe(0)
    expect(commands).toEqual([['launchctl', 'bootstrap', 'gui/501', join(root, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist')]])
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
