#!/usr/bin/env node
/**
 * Shadowed-peer guard — runs against the *built* host half, after `pnpm run build`.
 *
 * The failure this locks down is not a logic bug: `lib/index.js` used to take a
 * plain `import z from '@deepseek-ai/schemastery'`, so Node resolved the peer
 * from the plugin's own directory. A stale copy left next to the plugin (an
 * unmanaged dev tree copied in by a local-directory install, which pnpm never
 * removes) then shadowed the platform copy, and the missing `volatile()` method
 * threw while the entry was being imported — the whole host half vanished before
 * any plugin code ran.
 *
 * Two scenarios, both deterministic on a laptop and on a bare CI runner:
 *
 *   A. only a stale copy is reachable — the entry must still load and must report
 *      the stale copy instead of throwing;
 *   B. a platform copy is reachable — it must win over the stale copy beside the
 *      plugin, and `volatile()` must be available.
 *
 * Usage: node tests/guards/shadowed-peer.mjs
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCHEMASTERY = '@deepseek-ai/schemastery'
const STALE_VERSION = '3.18.2'
const script = fileURLToPath(import.meta.url)
const root = resolve(dirname(script), '..', '..')

/** Child mode: load one built entry and report what it resolved. */
if (process.argv[2] === '--scenario') {
  const entry = process.argv[3]
  try {
    const loaded = await import(pathToFileURL(entry).href)
    const runtime = loaded.schemaRuntime()
    const warning = runtime.warning
    console.log(JSON.stringify({
      ok: true,
      exports: Object.keys(loaded).sort(),
      volatile: runtime.volatile,
      source: runtime.source,
      version: runtime.version,
      path: runtime.path,
      candidates: runtime.candidates.map(candidate => ({
        source: candidate.source,
        path: candidate.path,
        version: candidate.version,
        volatile: candidate.volatile,
        error: candidate.error,
      })),
      warning: warning === null ? null : { code: warning.code, version: warning.version, nodeModulesDir: warning.nodeModulesDir },
    }))
  } catch (error) {
    console.error(`loading ${entry} failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  process.exit(0)
}

/** A stale copy: package-shaped, `volatile()` absent, exactly like 3.18.2. */
function plantStaleCopy(work) {
  const directory = join(work, 'node_modules', '@deepseek-ai', 'schemastery')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: SCHEMASTERY,
    version: STALE_VERSION,
    main: 'index.cjs',
  }))
  writeFileSync(join(directory, 'index.cjs'), [
    'function Schema() {}',
    'Schema.prototype.meta = {}',
    'Schema.prototype.default = function (value) { this.meta.default = value; return this }',
    'Schema.prototype.step = function () { return this }',
    'Schema.prototype.min = function () { return this }',
    'Schema.prototype.max = function () { return this }',
    'Schema.prototype.loose = function () { return this }',
    'const factory = function () { return new Schema() }',
    'factory.object = function (shape) { const schema = new Schema(); schema.dict = shape; return schema }',
    'factory.number = function () { return new Schema() }',
    'factory.boolean = function () { return new Schema() }',
    'factory.union = function () { return new Schema() }',
    'module.exports = factory',
    '',
  ].join('\n'))
  return directory
}

/** A throwaway install tree: the built entry, its manifest, and the planted copy. */
function makeWork() {
  const work = mkdtempSync(join(tmpdir(), 'dus-shadowed-peer-'))
  mkdirSync(join(work, 'lib'), { recursive: true })
  cpSync(join(root, 'lib', 'index.js'), join(work, 'lib', 'index.js'))
  cpSync(join(root, 'package.json'), join(work, 'package.json'))
  plantStaleCopy(work)
  return work
}

function run(entry, env) {
  const output = execFileSync(process.execPath, [script, '--scenario', entry], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(output.trim().split('\n').at(-1))
}

const failures = []
function check(condition, message) {
  if (!condition) failures.push(message)
}

function report(title, result) {
  console.log(`\n${title}`)
  console.log(`  resolved   ${result.version ?? 'unknown version'} via ${result.source}`)
  console.log(`  path       ${result.path ?? '(none)'}`)
  console.log(`  volatile   ${result.volatile ? 'available' : 'UNAVAILABLE'}`)
  console.log(`  warning    ${result.warning === null ? '(none)' : result.warning.code}`)
  for (const candidate of result.candidates) {
    const state = candidate.error === null ? `volatile=${candidate.volatile}` : `skipped: ${candidate.error}`
    console.log(`  candidate  ${candidate.source}: ${candidate.path ?? '(not loaded)'} — ${state}`)
  }
}

if (!existsSync(join(root, 'lib', 'index.js'))) {
  console.error(`shadowed-peer guard needs a build first: ${relative(root, join(root, 'lib', 'index.js'))} is missing`)
  process.exit(1)
}

const workA = makeWork()
// A sibling directory, never a parent of `workA`: otherwise the profile anchors
// would reach the planted copy by walking up and the scenario would prove nothing.
const emptyHome = mkdtempSync(join(tmpdir(), 'dus-shadowed-peer-home-'))
try {
  const entry = join(workA, 'lib', 'index.js')
  const result = run(entry, {
    DSH_HOME: emptyHome,
    DSH_PROFILE: 'web',
    DSH_PROFILE_DIR: join(emptyHome, 'profiles', 'web'),
  })
  report('A. stale copy only — the built entry must still load', result)
  check(result.ok === true, 'A: the built entry did not report a resolution')
  check(result.exports.includes('Config'), 'A: the built entry did not export Config')
  check(result.volatile === false, 'A: the stale copy should not report volatile support')
  check(result.source === 'plugin-local', `A: the shadowing copy beside the plugin should be the one loaded, got ${result.source}`)
  check(result.warning !== null && result.warning.code === 'stale-schemastery', 'A: the stale copy was not reported as a stale-schemastery warning')
  check(result.warning?.nodeModulesDir === realpathSync(join(workA, 'node_modules')), `A: the warning should name ${join(workA, 'node_modules')}`)
} catch (error) {
  failures.push(`A: the built entry failed to load beside a stale copy — ${error.stderr ?? error.message}`)
} finally {
  rmSync(workA, { recursive: true, force: true })
  rmSync(emptyHome, { recursive: true, force: true })
}

const realSchemastery = join(root, 'node_modules', '@deepseek-ai', 'schemastery')
if (!existsSync(realSchemastery)) {
  failures.push(`the guard needs an installed ${SCHEMASTERY} at ${relative(root, realSchemastery)}; run pnpm install first`)
} else {
  const workB = makeWork()
  try {
    const entry = join(workB, 'lib', 'index.js')
    const home = join(workB, '.dsh')
    const peers = join(home, 'profiles', 'node_modules', '@deepseek-ai')
    mkdirSync(peers, { recursive: true })
    symlinkSync(realSchemastery, join(peers, 'schemastery'), 'dir')
    const result = run(entry, {
      DSH_HOME: home,
      DSH_PROFILE: 'web',
      DSH_PROFILE_DIR: join(home, 'profiles', 'web'),
    })
    report('B. platform copy present — it must win over the stale copy', result)
    check(result.ok === true, 'B: the built entry did not report a resolution')
    check(result.volatile === true, 'B: the platform copy should report volatile support')
    check(result.source === 'profile-peers', `B: expected the profile peer farm to win, got ${result.source}`)
    check(result.path !== null && !result.path.startsWith(realpathSync(join(workB, 'node_modules'))), 'B: the stale copy beside the plugin won instead of the platform copy')
  } catch (error) {
    failures.push(`B: the built entry failed to load — ${error.stderr ?? error.message}`)
  } finally {
    rmSync(workB, { recursive: true, force: true })
  }
}

if (failures.length > 0) {
  console.error('\nshadowed-peer guard FAILED:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nshadowed-peer guard passed')
