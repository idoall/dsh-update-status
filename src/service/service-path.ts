/** Resolve one audited PATH that preflight and the native service both consume. */

import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { ServicePlatform, ServiceSpec } from './types.ts'

export type ServicePathSource = 'current' | 'minimal' | 'explicit'

export interface ResolvedServicePath {
  readonly source: ServicePathSource
  readonly value: string
  readonly pathExt?: string
  readonly warnings: readonly string[]
}

export interface ResolveServicePathOptions {
  readonly platform: ServicePlatform
  readonly nodePath: string
  readonly source: ServicePathSource
  readonly currentPath?: string
  readonly currentPathExt?: string
  readonly explicitPath?: string
  /** Platform base directories supplied by the caller (not package-manager guesses). */
  readonly minimalPath?: string
  readonly exists?: (path: string) => boolean
}

/** A service definition must stay inspectable; never silently truncate it. */
export const MAX_SERVICE_PATH_LENGTH = 8_192

const MINIMAL_POSIX: Readonly<Record<'darwin' | 'linux', readonly string[]>> = {
  darwin: ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'],
  linux: ['/usr/local/bin', '/usr/bin', '/bin'],
}

const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD'

export function normalizeServicePathExt(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_WINDOWS_PATHEXT
  validateText(raw)
  const seen = new Set<string>()
  const extensions: string[] = []
  for (const original of raw.split(';')) {
    const extension = original.trim()
    if (extension === '') continue
    if (!/^\.[A-Za-z0-9]+$/.test(extension)) throw new Error(`invalid PATHEXT entry: ${extension}`)
    const key = extension.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    extensions.push(extension)
  }
  if (extensions.length === 0) throw new Error('PATHEXT has no usable extension')
  return extensions.join(';')
}

function delimiter(platform: ServicePlatform): ':' | ';' {
  return platform === 'win32' ? ';' : ':'
}

function nodeDirectory(platform: ServicePlatform, nodePath: string): string {
  return platform === 'win32' ? win32.dirname(nodePath) : posix.dirname(nodePath)
}

function isAbsolute(platform: ServicePlatform, value: string): boolean {
  return platform === 'win32' ? win32.isAbsolute(value) : posix.isAbsolute(value)
}

function minimalEntries(platform: ServicePlatform, nodePath: string, override?: string): readonly string[] {
  const node = nodeDirectory(platform, nodePath)
  if (override !== undefined && override.trim() !== '') return [node, ...override.split(delimiter(platform))]
  if (platform === 'win32') return [node]
  return [node, ...MINIMAL_POSIX[platform]]
}

function sourceValue(options: ResolveServicePathOptions): string {
  if (options.source === 'minimal') return minimalEntries(options.platform, options.nodePath, options.minimalPath).join(delimiter(options.platform))
  if (options.source === 'explicit') {
    if (options.explicitPath === undefined || options.explicitPath.trim() === '') throw new Error('`--service-path` is required when `--path-source explicit` is used')
    return options.explicitPath
  }
  if (options.currentPath === undefined || options.currentPath.trim() === '') throw new Error('current PATH is empty; use `--path-source minimal` or `--service-path`')
  return options.currentPath
}

function validateText(value: string): void {
  // XML 1.0 forbids C0 controls except TAB; definitions for launchd/Task
  // Scheduler must be rejected before an otherwise valid preflight stages them.
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(value)) throw new Error('service PATH must not contain control characters or line breaks')
  if (value.length > MAX_SERVICE_PATH_LENGTH) throw new Error(`service PATH is too long (maximum ${String(MAX_SERVICE_PATH_LENGTH)} characters); use --service-path with a shorter value`)
}

/**
 * Resolve at install/plan time — no user rc file is executed. Missing absolute
 * directories are preserved (they may be mounted or created later) and reported.
 */
export function resolveServicePath(options: ResolveServicePathOptions): ResolvedServicePath {
  const split = delimiter(options.platform)
  const raw = sourceValue(options)
  validateText(raw)
  if (options.platform !== 'win32' && /(?:^|;)[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error('Windows-style PATH cannot be used for Linux/WSL; provide a colon-separated PATH')
  }
  const exists = options.exists ?? existsSync
  const warnings: string[] = []
  const values = [nodeDirectory(options.platform, options.nodePath), ...raw.split(split)]
  const seen = new Set<string>()
  const entries: string[] = []
  let warnedEmpty = false
  for (const rawEntry of values) {
    if (rawEntry === '') {
      if (!warnedEmpty) warnings.push('ignored empty PATH entry (current-directory lookup)')
      warnedEmpty = true
      continue
    }
    // Quoted entries are common in Windows PATH values with spaces. The quotes
    // delimit the entry; they are not part of the directory name.
    const entry = options.platform === 'win32' && rawEntry.length >= 2 && rawEntry.startsWith('"') && rawEntry.endsWith('"')
      ? rawEntry.slice(1, -1)
      : rawEntry
    if (!isAbsolute(options.platform, entry)) {
      warnings.push(`ignored relative PATH entry: ${entry}`)
      continue
    }
    const key = options.platform === 'win32' ? entry.toLowerCase() : entry
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
    if (!exists(entry)) warnings.push(`PATH directory does not exist yet: ${entry}`)
  }
  const value = entries.join(split)
  if (value === '') throw new Error('service PATH has no absolute directory')
  validateText(value)
  const pathExt = options.platform === 'win32' ? normalizeServicePathExt(options.currentPathExt) : undefined
  return {
    source: options.source,
    value,
    ...(pathExt === undefined ? {} : { pathExt }),
    warnings,
  }
}

/** Old receipts had no PATH fields; keep their exact historical minimal shape. */
export function servicePathOf(spec: Pick<ServiceSpec, 'platform' | 'nodePath' | 'servicePath'>): string {
  return spec.servicePath ?? minimalEntries(spec.platform, spec.nodePath).join(delimiter(spec.platform))
}
