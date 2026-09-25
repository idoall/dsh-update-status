/**
 * dsh-update-status — peer resolution specs.
 *
 * `@deepseek-ai/schemastery` is the one peer this plugin cannot take by bare
 * specifier: Node resolves it from the importing file, so a stale copy left next
 * to the plugin shadows the platform's copy and its missing `volatile()` throws
 * while the host half is being imported — before any plugin code runs. These
 * specs lock the two properties that keep that state survivable:
 *
 * - the resolution tries platform copies first and only accepts a copy that
 *   actually exposes `volatile()`, and
 * - a resolution that cannot find it still loads and reports what it used,
 *   instead of throwing during import.
 *
 * The last block is the source guard for the root cause: no file in `src/` may
 * take a *value* import of the peer again.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import realSchema from '@deepseek-ai/schemastery'
import { defaultSchemaCandidates, describeSchemaRuntime, resolveSchemaRuntime, SCHEMASTERY_NAME } from '../../src/host/schemastery.ts'
import { buildConfigSchema } from '../../src/host/settings.ts'

const temporaryDirectories: string[] = []

function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dus-peer-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A package-shaped schemastery whose `volatile()` can be present or absent. */
const FAKE_FACTORY = [
  'function Schema() {}',
  'Schema.prototype.meta = {}',
  'Schema.prototype.default = function (value) { this.meta.default = value; return this }',
  'Schema.prototype.step = function () { return this }',
  'Schema.prototype.min = function () { return this }',
  'Schema.prototype.max = function () { return this }',
  'Schema.prototype.loose = function () { return this }',
  '/*VOLATILE*/',
  'const factory = function () { return new Schema() }',
  'factory.object = function (shape) { const schema = new Schema(); schema.dict = shape; return schema }',
  'factory.number = function () { return new Schema() }',
  'factory.boolean = function () { return new Schema() }',
  'factory.union = function () { return new Schema() }',
  '/*EXPORT*/',
  '',
].join('\n')

const EXPORTS = {
  direct: 'module.exports = factory',
  wrapped: 'module.exports = { default: factory }',
  empty: 'module.exports = {}',
} as const

function writeSchemaPackage(
  root: string,
  options: { version: string; volatile: boolean; exportShape?: keyof typeof EXPORTS },
): string {
  const directory = join(root, 'node_modules', '@deepseek-ai', 'schemastery')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: SCHEMASTERY_NAME,
    version: options.version,
    main: 'index.cjs',
  }))
  const volatile = options.volatile
    ? 'Schema.prototype.volatile = function () { this.meta.volatile = true; return this }'
    : ''
  writeFileSync(join(directory, 'index.cjs'), FAKE_FACTORY
    .replace('/*VOLATILE*/', volatile)
    .replace('/*EXPORT*/', EXPORTS[options.exportShape ?? 'direct']))
  return directory
}

describe('schema resolution', () => {
  it('prefers the platform copy over a stale copy beside the plugin', () => {
    const platform = temporaryRoot()
    const shadow = temporaryRoot()
    writeSchemaPackage(platform, { version: '3.18.4', volatile: true })
    writeSchemaPackage(shadow, { version: '3.18.2', volatile: false })

    const runtime = resolveSchemaRuntime({
      candidates: [
        { source: 'dsh-install', anchor: join(platform, 'probe.cjs') },
        { source: 'plugin-local', anchor: join(shadow, 'probe.cjs') },
      ],
    })

    expect(runtime.volatile).toBe(true)
    expect(runtime.source).toBe('dsh-install')
    expect(runtime.version).toBe('3.18.4')
    expect(runtime.warning).toBeNull()
    // The shadowing copy was never even loaded: the first usable candidate wins.
    expect(runtime.candidates).toHaveLength(1)
  })

  it('keeps loading on a stale copy and reports exactly what to remove', () => {
    const shadow = temporaryRoot()
    writeSchemaPackage(shadow, { version: '3.18.2', volatile: false })

    const runtime = resolveSchemaRuntime({
      candidates: [{ source: 'plugin-local', anchor: join(shadow, 'probe.cjs') }],
    })

    expect(runtime.volatile).toBe(false)
    expect(runtime.version).toBe('3.18.2')
    const warning = runtime.warning
    if (warning?.code !== 'stale-schemastery') throw new Error('expected a stale-schemastery warning')
    expect(warning.version).toBe('3.18.2')
    // The resolver reports real paths, so /var and /private/var agree on macOS.
    expect(warning.nodeModulesDir).toBe(realpathSync(join(shadow, 'node_modules')))
    expect(warning.path).toContain('schemastery')
  })

  it('skips an unresolvable candidate and keeps searching', () => {
    const empty = temporaryRoot()
    const shadow = temporaryRoot()
    writeSchemaPackage(shadow, { version: '3.18.2', volatile: false })

    const runtime = resolveSchemaRuntime({
      candidates: [
        { source: 'dsh-install', anchor: join(empty, 'probe.cjs') },
        { source: 'profile-peers', anchor: join(shadow, 'probe.cjs') },
      ],
    })

    expect(runtime.source).toBe('profile-peers')
    expect(runtime.candidates[0]?.error).toBeTruthy()
    expect(runtime.candidates[1]?.error).toBeNull()
  })

  it('unwraps a default-wrapped factory instead of taking the wrapper', () => {
    const wrapped = temporaryRoot()
    writeSchemaPackage(wrapped, { version: '3.18.2', volatile: false, exportShape: 'wrapped' })

    const runtime = resolveSchemaRuntime({
      candidates: [{ source: 'plugin-local', anchor: join(wrapped, 'probe.cjs') }],
    })

    // The wrapper cannot build a schema, so choosing it would throw while the
    // entry loads — the exact failure this resolution exists to avoid.
    expect(runtime.volatile).toBe(false)
    expect(Object.keys(buildConfigSchema(runtime.z as typeof realSchema, false).dict ?? {})).toHaveLength(6)
  })

  it('skips a module that exports no factory at all', () => {
    const broken = temporaryRoot()
    const good = temporaryRoot()
    writeSchemaPackage(broken, { version: '3.18.2', volatile: false, exportShape: 'empty' })
    writeSchemaPackage(good, { version: '3.18.2', volatile: false })

    const runtime = resolveSchemaRuntime({
      candidates: [
        { source: 'plugin-local', anchor: join(broken, 'probe.cjs') },
        { source: 'profile-peers', anchor: join(good, 'probe.cjs') },
      ],
    })
    expect(runtime.candidates[0]?.error).toContain('schemastery factory')
    expect(runtime.source).toBe('profile-peers')
  })

  it('throws only when nothing resolves, naming every candidate', () => {
    const empty = temporaryRoot()
    expect(() => resolveSchemaRuntime({
      candidates: [{ source: 'dsh-install', anchor: join(empty, 'probe.cjs') }],
    })).toThrow(/could not resolve .*dsh-install/)
  })

  it('orders the default candidates platform-first and the shadowable walk last', () => {
    const candidates = defaultSchemaCandidates()
    expect(candidates.at(-1)?.source).toBe('plugin-local')
    expect(new Set(candidates.map(candidate => candidate.source)).size).toBe(candidates.length)
    for (const candidate of candidates) expect(candidate.anchor.startsWith('/')).toBe(true)
  })

  it('describes a resolution in one line for the Host log', () => {
    const shadow = temporaryRoot()
    writeSchemaPackage(shadow, { version: '3.18.2', volatile: false })
    const runtime = resolveSchemaRuntime({
      candidates: [{ source: 'plugin-local', anchor: join(shadow, 'probe.cjs') }],
    })
    expect(describeSchemaRuntime(runtime)).toContain('3.18.2')
    expect(describeSchemaRuntime(runtime)).toContain('volatile preferences unavailable')
  })
})

describe('degraded Config form', () => {
  function volatileFields(schema: ReturnType<typeof buildConfigSchema>): string[] {
    return Object.entries(schema.dict ?? {})
      .filter(([, field]) => field.meta.volatile === true)
      .map(([name]) => name)
      .sort()
  }

  it('marks exactly the preferences volatile when the capability is present', () => {
    expect(volatileFields(buildConfigSchema(realSchema, true)))
      .toEqual(['cacheTtlMinutes', 'channel', 'sidebarEnabled'])
  })

  it('builds the same fields as ordinary ones instead of throwing without it', () => {
    const degraded = buildConfigSchema(realSchema, false)
    expect(volatileFields(degraded)).toEqual([])
    expect(Object.keys(degraded.dict ?? {}).sort()).toEqual([
      'autoCheckOnMount', 'cacheTtlHours', 'cacheTtlMinutes', 'channel', 'sidebarEnabled', 'timeoutMs',
    ])
    const field = degraded.dict?.channel?.meta as { default?: unknown }
    expect(field.default).toBe('latest')
    expect(degraded.dict?.cacheTtlMinutes?.meta.default).toBe(360)
  })

  it('accepts a factory whose schemas are structurally the same', () => {
    const shadow = temporaryRoot()
    writeSchemaPackage(shadow, { version: '3.18.2', volatile: false })
    const runtime = resolveSchemaRuntime({
      candidates: [{ source: 'plugin-local', anchor: join(shadow, 'probe.cjs') }],
    })
    // A degraded resolution must still produce a Config the Loader can read.
    const degraded = buildConfigSchema(runtime.z as typeof realSchema, runtime.volatile)
    expect(Object.keys(degraded.dict ?? {}).sort()).toEqual([
      'autoCheckOnMount', 'cacheTtlHours', 'cacheTtlMinutes', 'channel', 'sidebarEnabled', 'timeoutMs',
    ])
    expect(volatileFields(degraded)).toEqual([])
  })
})

describe('source guard: the peer is never imported by value', () => {
  const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url))
  const VALUE_IMPORT = /(?:^|\n)[ \t]*(?:import|export)[ \t]+(?!type\b)[^\n]*?from[ \t]*['"]@deepseek-ai\/schemastery['"]/g
  const SIDE_EFFECT_IMPORT = /(?:^|\n)[ \t]*import[ \t]*['"]@deepseek-ai\/schemastery['"]/g
  const LITERAL_REQUIRE = /require\([ \t]*['"]@deepseek-ai\/schemastery['"][ \t]*\)/g

  function sourceFiles(directory: string): string[] {
    const found: string[] = []
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
      else if (/\.tsx?$/.test(entry)) found.push(path)
    }
    return found
  }

  /** Comments may quote the bare import; only real statements count. */
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  }

  function valueImportsOf(text: string): string[] {
    const stripped = withoutComments(text)
    return [
      ...stripped.match(VALUE_IMPORT) ?? [],
      ...stripped.match(SIDE_EFFECT_IMPORT) ?? [],
      ...stripped.match(LITERAL_REQUIRE) ?? [],
    ]
  }

  it('recognises the regression it exists to catch', () => {
    expect(valueImportsOf("import z from '@deepseek-ai/schemastery'")).toHaveLength(1)
    expect(valueImportsOf("const z = require('@deepseek-ai/schemastery')")).toHaveLength(1)
    expect(valueImportsOf("import type z from '@deepseek-ai/schemastery'")).toHaveLength(0)
    expect(valueImportsOf('// import z from \'@deepseek-ai/schemastery\'')).toHaveLength(0)
  })

  it('holds for every file in src', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(sourceRoot)) {
      for (const statement of valueImportsOf(readFileSync(file, 'utf8'))) {
        offenders.push(`${file}: ${statement.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
