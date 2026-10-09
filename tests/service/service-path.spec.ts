import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_SERVICE_PATH_LENGTH,
  resolveServicePath,
  servicePathOf,
  type ServicePathSource,
} from '../../src/service/service-path.ts'

const node = '/Users/me/.nvm/versions/node/v24/bin/node'

function resolve(overrides: Partial<Parameters<typeof resolveServicePath>[0]> = {}) {
  return resolveServicePath({
    platform: 'darwin',
    nodePath: node,
    source: 'current',
    currentPath: '/opt/pkg/env/active/bin:/Users/me/.cargo/bin:/usr/bin:/bin',
    exists: () => true,
    ...overrides,
  })
}

describe('service PATH resolution', () => {
  it('defaults to the invoking process PATH and puts the selected Node first', () => {
    expect(resolve()).toEqual({
      source: 'current',
      value: '/Users/me/.nvm/versions/node/v24/bin:/opt/pkg/env/active/bin:/Users/me/.cargo/bin:/usr/bin:/bin',
      warnings: [],
    })
  })

  it('covers arbitrary package managers without naming any of them', () => {
    const currentPath = [
      '/opt/homebrew/bin', '/opt/local/bin', '/opt/pkg/env/active/bin',
      '/nix/var/nix/profiles/default/bin', '/Users/me/.asdf/shims',
      '/Users/me/opt/anaconda3/bin', '/Users/me/.cargo/bin', '/Users/me/.local/bin',
    ].join(':')
    const resolved = resolve({ currentPath })
    expect(resolved.value.split(':')).toEqual([
      '/Users/me/.nvm/versions/node/v24/bin', ...currentPath.split(':'),
    ])
  })

  it('removes empty and relative entries, preserves missing absolute entries with a warning, and dedupes in order', () => {
    const resolved = resolve({
      currentPath: ':/usr/bin:relative/bin:/future/tool/bin:/usr/bin:/bin:',
      exists: path => path !== '/future/tool/bin',
    })
    expect(resolved.value).toBe('/Users/me/.nvm/versions/node/v24/bin:/usr/bin:/future/tool/bin:/bin')
    expect(resolved.warnings).toEqual([
      'ignored empty PATH entry (current-directory lookup)',
      'ignored relative PATH entry: relative/bin',
      'PATH directory does not exist yet: /future/tool/bin',
    ])
  })

  it('supports a deterministic minimal mode with no package-manager guesses', () => {
    expect(resolve({ source: 'minimal', currentPath: undefined })).toEqual({
      source: 'minimal',
      value: '/Users/me/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      warnings: [],
    })
    expect(resolveServicePath({
      platform: 'win32', nodePath: 'D:\\Node\\node.exe', source: 'minimal',
      minimalPath: 'D:\\Windows\\System32;D:\\Windows', exists: () => true,
    }).value).toBe('D:\\Node;D:\\Windows\\System32;D:\\Windows')
  })

  it('supports an explicit service path and records its source', () => {
    expect(resolve({ source: 'explicit', explicitPath: '/custom/one:/custom/two' })).toMatchObject({
      source: 'explicit',
      value: '/Users/me/.nvm/versions/node/v24/bin:/custom/one:/custom/two',
    })
  })

  it('fails clearly instead of silently truncating, guessing, or accepting control characters', () => {
    expect(() => resolve({ currentPath: undefined })).toThrow('current PATH is empty')
    expect(() => resolve({ source: 'explicit', explicitPath: undefined })).toThrow('`--service-path` is required')
    expect(() => resolve({ currentPath: '/ok\n/hidden' })).toThrow('control characters')
    expect(() => resolve({ currentPath: '/ok\u0001/hidden' })).toThrow('control characters')
    expect(() => resolve({ currentPath: `/a/${'x'.repeat(MAX_SERVICE_PATH_LENGTH)}` })).toThrow('too long')
  })

  it('preserves absolute entries with spaces exactly as the invoking process supplied them', () => {
    const value = '/Applications/VMware OVF Tool:/Users/me/My Tools/bin:/usr/bin'
    expect(resolve({ currentPath: value }).value).toBe(`/Users/me/.nvm/versions/node/v24/bin:${value}`)
  })

  it('uses Windows separators, handles drive, quoted spaces and UNC paths, dedupes case-insensitively, and carries PATHEXT', () => {
    const resolved = resolveServicePath({
      platform: 'win32',
      nodePath: 'C:\\Node\\node.exe',
      source: 'current',
      currentPath: 'C:\\Tools;C:\\tools;"C:\\Program Files\\Vendor Bin";\\\\server\\share\\bin;relative;C:\\Windows\\System32',
      currentPathExt: '.COM;.EXE;.exe;.BAT;.CMD',
      exists: () => true,
    })
    expect(resolved).toEqual({
      source: 'current',
      value: 'C:\\Node;C:\\Tools;C:\\Program Files\\Vendor Bin;\\\\server\\share\\bin;C:\\Windows\\System32',
      pathExt: '.COM;.EXE;.BAT;.CMD',
      warnings: ['ignored relative PATH entry: relative'],
    })
    expect(() => resolveServicePath({
      platform: 'win32', nodePath: 'C:\\Node\\node.exe', source: 'current', currentPath: 'C:\\Tools',
      currentPathExt: '.EXE\n.CMD', exists: () => true,
    })).toThrow('line breaks')
    expect(() => resolveServicePath({
      platform: 'win32', nodePath: 'C:\\Node\\node.exe', source: 'current', currentPath: 'C:\\Tools',
      currentPathExt: '.EXE;CMD;.*', exists: () => true,
    })).toThrow('invalid PATHEXT entry')
  })

  it('treats WSL as Linux and never writes a semicolon Windows PATH into it', () => {
    expect(() => resolveServicePath({
      platform: 'linux', nodePath: '/usr/bin/node', source: 'current',
      currentPath: 'C:\\Windows\\System32;C:\\Tools', exists: () => true,
    })).toThrow('Windows-style PATH cannot be used for Linux/WSL')
  })

  it('lets a child process resolve a command by name through the final PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'dus-path-command-'))
    try {
      const name = process.platform === 'win32' ? 'dus-path-probe.cmd' : 'dus-path-probe'
      const file = join(root, name)
      writeFileSync(file, process.platform === 'win32' ? '@echo found\r\n' : '#!/bin/sh\nprintf found\n', 'utf8')
      if (process.platform !== 'win32') chmodSync(file, 0o700)
      const resolved = resolveServicePath({
        platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
        nodePath: process.execPath,
        source: 'explicit', explicitPath: root,
        currentPathExt: '.COM;.EXE;.BAT;.CMD', exists: () => true,
      })
      const result = spawnSync('dus-path-probe', [], {
        encoding: 'utf8', shell: process.platform === 'win32',
        env: { PATH: resolved.value, ...(resolved.pathExt === undefined ? {} : { PATHEXT: resolved.pathExt }) },
      })
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('found')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renders the same persisted PATH on every later read and falls back only for an old receipt', () => {
    const source: ServicePathSource = 'explicit'
    expect(servicePathOf({ platform: 'darwin', nodePath: node, servicePath: '/saved/path' })).toBe('/saved/path')
    expect(source).toBe('explicit')
    expect(servicePathOf({ platform: 'linux', nodePath: '/opt/node/bin/node' })).toBe('/opt/node/bin:/usr/local/bin:/usr/bin:/bin')
  })
})
