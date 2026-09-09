/**
 * Read-only facts about the DSH process installation. No shell command is run:
 * the probe reads only package manifests and Node resolution anchors already
 * available to the current Host process.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InstallKind } from '../shared/types.ts'
import { PACKAGE_NAME } from '../shared/types.ts'

export interface InstallationInfo {
  currentVersion: string
  packageName: string
  channel: string
  installKind: InstallKind
  packageRoot?: string
  upgradeCommand: string
}

interface Manifest {
  name?: unknown
  version?: unknown
}

type RequireResolve = (specifier: string) => string

function manifestAt(path: string): { version: string; root: string } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Manifest
    if (parsed.name !== PACKAGE_NAME || typeof parsed.version !== 'string' || parsed.version.trim() === '') return undefined
    return { version: parsed.version.trim(), root: dirname(path) }
  } catch {
    return undefined
  }
}

function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Ascend from an entry file until the owning DSH package manifest is found. */
export function manifestFromEntry(entryPath: string): { version: string; root: string } | undefined {
  let directory = dirname(realPath(entryPath))
  for (let depth = 0; depth < 10; depth += 1) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      const found = manifestAt(manifest)
      if (found !== undefined) return { ...found, root: realPath(found.root) }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

function manifestFromResolver(resolve: RequireResolve): { version: string; root: string } | undefined {
  try {
    const manifestPath = resolve(PACKAGE_NAME + '/package.json')
    const found = manifestAt(manifestPath)
    if (found !== undefined) return { ...found, root: realPath(found.root) }
  } catch {
    // Export maps can withhold ./package.json; entry probing below handles that.
  }
  try {
    return manifestFromEntry(resolve(PACKAGE_NAME))
  } catch {
    return undefined
  }
}

function homeResolver(ctx: unknown): RequireResolve | undefined {
  try {
    const get = (ctx as { get?: (name: string) => unknown }).get
    const dshHomePath = typeof get === 'function' ? get.call(ctx, 'dshHomePath') : undefined
    if (typeof dshHomePath !== 'function') return undefined
    const anchor = (dshHomePath as (...segments: string[]) => string)('profiles', 'dsh-update-status-probe.cjs')
    return createRequire(anchor).resolve
  } catch {
    return undefined
  }
}

function ownResolver(selfUrl: string): RequireResolve | undefined {
  try {
    return createRequire(selfUrl).resolve
  } catch {
    return undefined
  }
}

/**
 * Classify only when path evidence is strong. A profile-local mirror must not
 * be advertised as an upgradeable global installation, hence the conservative
 * unknown fallback.
 */
export function classifyInstallRoot(packageRoot: string | undefined, nodePrefix: string | undefined = process.execPath): InstallKind {
  if (packageRoot === undefined) return 'unknown'
  const root = normalize(realPath(packageRoot)).split(sep).join('/')
  const prefix = nodePrefix === undefined ? '' : normalize(dirname(dirname(nodePrefix))).split(sep).join('/')

  if (!root.includes('/node_modules/') && /\/apps\/cli(?:\/|$)/.test(root)) return 'source-checkout'
  if (root.includes('/.pnpm/') || /\/pnpm\/global(?:\/|$)/.test(root)) return 'pnpm-global'
  if (prefix !== '' && root.startsWith(prefix + '/lib/node_modules/')) return 'npm-global'
  if (/\/lib\/node_modules\/@deepseek-ai\/dsh$/.test(root)) return 'npm-global'
  return 'unknown'
}

/** Generate guidance only; this package never invokes the string it returns. */
export function upgradeCommandFor(installKind: InstallKind, packageName: string = PACKAGE_NAME, channel: string = 'latest'): string {
  const specifier = `${packageName}@${channel}`
  switch (installKind) {
    case 'npm-global': return `npm install -g ${specifier}`
    case 'pnpm-global': return `pnpm add -g ${specifier}`
    case 'source-checkout': return '在 DSH checkout 中拉取代码、安装依赖并重新构建；插件不会从 GUI 原地替换'
    default: return '请确认 dsh 安装方式后再升级；当前插件不会代为执行'
  }
}

/**
 * Resolve the package that launched this process first, then the DSH home
 * mirror and finally this plugin's resolver. All failures degrade safely.
 */
export function detectInstallation(ctx: unknown, selfUrl: string = import.meta.url): InstallationInfo {
  const argvEntry = typeof process.argv[1] === 'string' ? manifestFromEntry(process.argv[1]) : undefined
  const fromHome = homeResolver(ctx)
  const home = fromHome === undefined ? undefined : manifestFromResolver(fromHome)
  const own = ownResolver(selfUrl)
  const local = own === undefined ? undefined : manifestFromResolver(own)
  const found = argvEntry ?? home ?? local
  const installKind = classifyInstallRoot(found?.root)
  const channel = 'latest'
  return {
    currentVersion: found?.version ?? 'unknown',
    packageName: PACKAGE_NAME,
    channel,
    installKind,
    ...(found?.root === undefined ? {} : { packageRoot: found.root }),
    upgradeCommand: upgradeCommandFor(installKind, PACKAGE_NAME, channel),
  }
}

/** Useful in diagnostics/tests without exposing a Node file URL to the browser. */
export function moduleFilePath(selfUrl: string = import.meta.url): string | undefined {
  try {
    return fileURLToPath(selfUrl)
  } catch {
    return undefined
  }
}
