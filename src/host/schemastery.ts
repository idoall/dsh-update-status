/**
 * dsh-update-status — shadow-proof resolution of the platform's schemastery.
 *
 * `@deepseek-ai/schemastery` is a peer dependency: DSH ships it, and DSH's copy
 * is the one carrying `volatile()` — the Loader's volatile-field projection this
 * plugin's settings form is built on. A plain
 * `import z from '@deepseek-ai/schemastery'` is resolved by Node's own directory
 * walk *from the importing file*, so any copy sitting next to the plugin wins
 * over the platform's copy. That is not hypothetical: an unmanaged tree left
 * inside the install directory — a dev `node_modules` copied in by a
 * local-directory install, which pnpm never removes — made `lib/index.js` throw
 * `TypeError: …volatile is not a function` while it was being imported, so the
 * whole host half disappeared before one line of plugin code ran.
 *
 * Nothing inside the plugin can repair that state: the failure precedes every
 * plugin entry point. The resolution itself is made immune instead, trying
 * platform copies before anything else:
 *
 * 1. the DSH installation running this process,
 * 2. the profile peer farm DSH maintains (`$DSH_HOME/profiles/node_modules`),
 * 3. the active profile's own tree,
 * 4. whatever Node's walk finds next to this file — last resort.
 *
 * The first candidate that actually exposes `volatile()` wins, and the
 * capability is verified rather than assumed. When no candidate provides it, the
 * plugin still loads on the best copy it could load and reports exactly what it
 * resolved: the missing capability becomes a `stale-schemastery` warning the
 * panel renders instead of a dead plugin.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UpdateWarning } from '../shared/types.ts'
import { manifestFromEntry } from './installation.ts'

export const SCHEMASTERY_NAME = '@deepseek-ai/schemastery'
/** Anchor file name; it never has to exist, only to give `createRequire` a base. */
const PROBE_FILE = 'dsh-update-status-peer-probe.cjs'
const MAX_ASCENT = 10

/** Where a candidate copy of schemastery was looked for. */
export type SchemaCandidateSource = 'dsh-install' | 'profile-peers' | 'profile-local' | 'plugin-local'

export interface SchemaCandidate {
  source: SchemaCandidateSource
  /** Absolute file path `createRequire` anchors on; the file need not exist. */
  anchor: string
}

export interface SchemaCandidateReport {
  source: SchemaCandidateSource
  anchor: string
  /** Absolute path of the module that loaded, or null when it did not load. */
  path: string | null
  version: string | null
  /** The loaded module exposes `volatile()`. */
  volatile: boolean
  /** Why this candidate was skipped, or null when it loaded. */
  error: string | null
}

export interface SchemaRuntime {
  /** The loaded schemastery factory — structurally the package's default export. */
  z: unknown
  volatile: boolean
  source: SchemaCandidateSource
  path: string | null
  version: string | null
  /** Every candidate that was tried, in order, for diagnostics. */
  candidates: SchemaCandidateReport[]
  /** Set when the resolved copy cannot project volatile preferences. */
  warning: UpdateWarning | null
}

export interface ResolveSchemaRuntimeOptions {
  /** Override the candidate order; used by tests and by an embedding host. */
  candidates?: readonly SchemaCandidate[]
}

function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function boundedMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed === '' ? 'unknown error' : trimmed.slice(0, 220)
}

function environmentDirectory(name: string): string | null {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** The DSH home directory, from the environment first and `~/.dsh` as a fallback. */
export function dshHomeDirectory(): string | null {
  const configured = environmentDirectory('DSH_HOME')
  if (configured !== null) return configured
  try {
    return join(homedir(), '.dsh')
  } catch {
    return null
  }
}

/** The active profile directory, from `$DSH_PROFILE_DIR` or `$DSH_HOME/profiles/<profile>`. */
export function profileDirectory(): string | null {
  const configured = environmentDirectory('DSH_PROFILE_DIR')
  if (configured !== null) return configured
  const home = dshHomeDirectory()
  const profile = environmentDirectory('DSH_PROFILE')
  return home === null || profile === null ? null : join(home, 'profiles', profile)
}

/**
 * Anchor on the DSH package that owns the running entry point.
 *
 * The entry is the CLI file Node was started with, so ascending from it reaches
 * the DSH installation whose `node_modules` holds the platform's schemastery.
 * Reusing `manifestFromEntry` keeps this probe identical to the installation
 * detection the status read already performs.
 */
function dshInstallAnchor(): string | null {
  const entry = process.argv[1]
  if (typeof entry !== 'string' || entry === '') return null
  const found = manifestFromEntry(entry)
  return found === undefined || found.root === '' ? null : join(found.root, 'package.json')
}

/** Candidate order: platform copies first, the shadowable walk last. */
export function defaultSchemaCandidates(): SchemaCandidate[] {
  const candidates: SchemaCandidate[] = []
  const install = dshInstallAnchor()
  if (install !== null) candidates.push({ source: 'dsh-install', anchor: install })
  const home = dshHomeDirectory()
  if (home !== null) candidates.push({ source: 'profile-peers', anchor: join(home, 'profiles', PROBE_FILE) })
  const profile = profileDirectory()
  if (profile !== null) candidates.push({ source: 'profile-local', anchor: join(profile, PROBE_FILE) })
  candidates.push({ source: 'plugin-local', anchor: fileURLToPath(import.meta.url) })
  return candidates
}

function manifestVersion(manifestPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; version?: unknown }
    if (parsed.name !== SCHEMASTERY_NAME || typeof parsed.version !== 'string') return null
    const version = parsed.version.trim()
    return version === '' ? null : version
  } catch {
    return null
  }
}

/** Read the version of the schemastery package that owns a resolved entry path. */
function versionOfResolved(resolvedPath: string): string | null {
  let directory = dirname(realPath(resolvedPath))
  for (let depth = 0; depth < MAX_ASCENT; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const version = manifestVersion(manifestPath)
      if (version !== null) return version
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

/** The nearest `node_modules` directory above a resolved package entry. */
function nodeModulesDirectoryOf(resolvedPath: string | null): string | null {
  if (resolvedPath === null) return null
  let directory = dirname(realPath(resolvedPath))
  for (let depth = 0; depth < MAX_ASCENT; depth += 1) {
    if (basename(directory) === 'node_modules') return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

/**
 * Does this module expose the Loader's volatile projection?
 *
 * The probe builds a throwaway field because the capability is a prototype
 * method, not a flag: 3.18.2 has no `volatile` at all, 3.18.4 (the copy DSH
 * ships) does. Never throws — an unusable module is simply not a candidate.
 */
function supportsVolatile(factory: unknown): boolean {
  if (factory === null || (typeof factory !== 'object' && typeof factory !== 'function')) return false
  try {
    const boolean = (factory as { boolean?: () => unknown }).boolean
    if (typeof boolean !== 'function') return false
    const field = boolean.call(factory) as { default?: (value: unknown) => unknown } | null | undefined
    if (field === null || field === undefined || typeof field.default !== 'function') return false
    const defined = field.default(true) as { volatile?: unknown } | null | undefined
    return defined !== null && defined !== undefined && typeof defined.volatile === 'function'
  } catch {
    return false
  }
}

interface LoadedCandidate {
  report: SchemaCandidateReport
  factory: unknown
}

/** Can this value build a schema? A wrapper object that cannot is never chosen. */
function isSchemaFactory(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  const record = value as { object?: unknown; boolean?: unknown; number?: unknown }
  return typeof record.object === 'function' && typeof record.boolean === 'function' && typeof record.number === 'function'
}

/**
 * Pick the factory out of the shapes a CommonJS build can expose.
 *
 * The package assigns `module.exports` directly, but a bundler or an interop
 * wrapper can put the same factory behind `default`. A shape that cannot build a
 * schema is never chosen even as a fallback, because the degraded path still has
 * to produce a `Config` — a wrapper object would throw while the entry loads,
 * which is the failure this module exists to prevent.
 */
function factoryOf(loaded: unknown): unknown {
  const wrapper = loaded !== null && (typeof loaded === 'object' || typeof loaded === 'function')
    ? loaded as { default?: unknown }
    : undefined
  const shapes = [loaded, wrapper?.default].filter(isSchemaFactory)
  return shapes.find(supportsVolatile) ?? shapes[0]
}

function loadCandidate(candidate: SchemaCandidate): LoadedCandidate {
  const report: SchemaCandidateReport = {
    source: candidate.source,
    anchor: candidate.anchor,
    path: null,
    version: null,
    volatile: false,
    error: null,
  }
  try {
    const require = createRequire(candidate.anchor)
    const resolved = require.resolve(SCHEMASTERY_NAME)
    const factory = factoryOf(require(resolved))
    if (factory === undefined) throw new Error('module does not export a schemastery factory')
    report.path = realPath(resolved)
    report.version = versionOfResolved(resolved)
    report.volatile = supportsVolatile(factory)
    return { report, factory }
  } catch (error) {
    report.error = boundedMessage(error)
    return { report, factory: undefined }
  }
}

/**
 * Resolve schemastery once, preferring the copy that can actually do the job.
 *
 * Only a total miss throws, and only with the per-candidate reasons attached:
 * that state means the plugin is not running inside a working DSH installation,
 * so there is no schema system to build a settings form with. Every other
 * outcome loads.
 */
export function resolveSchemaRuntime(options: ResolveSchemaRuntimeOptions = {}): SchemaRuntime {
  const candidates = options.candidates ?? defaultSchemaCandidates()
  const reports: SchemaCandidateReport[] = []
  let usable: LoadedCandidate | undefined
  let loaded: LoadedCandidate | undefined
  for (const candidate of candidates) {
    const attempt = loadCandidate(candidate)
    reports.push(attempt.report)
    if (attempt.factory === undefined) continue
    loaded ??= attempt
    if (attempt.report.volatile) {
      usable = attempt
      break
    }
  }
  const chosen = usable ?? loaded
  if (chosen === undefined) {
    const tried = reports.map(report => `${report.source}: ${report.error ?? 'not loadable'}`).join('; ')
    throw new Error(`dsh-update-status could not resolve ${SCHEMASTERY_NAME} (${tried})`)
  }
  return {
    z: chosen.factory,
    volatile: chosen.report.volatile,
    source: chosen.report.source,
    path: chosen.report.path,
    version: chosen.report.version,
    candidates: reports,
    warning: chosen.report.volatile
      ? null
      : {
          code: 'stale-schemastery',
          version: chosen.report.version,
          path: chosen.report.path ?? chosen.report.anchor,
          nodeModulesDir: nodeModulesDirectoryOf(chosen.report.path),
        },
  }
}

let resolved: SchemaRuntime | undefined

/**
 * The process-wide resolution, computed on first use.
 *
 * The settings schema is built at module scope — the Loader reads the exported
 * `Config` before `apply` runs — so the resolution cannot wait for a Host
 * context. Every input here comes from the process environment or the filesystem.
 */
export function schemaRuntime(): SchemaRuntime {
  resolved ??= resolveSchemaRuntime()
  return resolved
}

/** English, single-line summary of a resolution, for the Host log. */
export function describeSchemaRuntime(runtime: SchemaRuntime): string {
  const where = runtime.path === null ? runtime.source : `${runtime.path} (${runtime.source})`
  const version = runtime.version === null ? '' : `@${runtime.version}`
  return `${SCHEMASTERY_NAME}${version} from ${where}; volatile preferences ${runtime.volatile ? 'available' : 'unavailable'}`
}
