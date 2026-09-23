/**
 * dsh-update-status — Host Config form specs.
 *
 * DSH 0.1.7 removed `ctx.settings.register(...)`: a settings form IS the
 * VOLATILE field set of the plugin entry's own `Config`, and the namespace IS
 * the Loader entry id (`docs/subsystems/settings.md`). These specs lock both
 * halves of that contract, because either one silently breaking detaches the
 * preferences from their storage:
 *
 * - exactly `sidebarEnabled`, `channel` and `cacheTtlMinutes` are volatile, so
 *   the form exposes the user preferences and never the deployment fields;
 * - `installSettings` suppresses the auto-generated generic page for this
 *   entry, and stays contained when the settings service is absent or refuses.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Config, installSettings } from '../../src/host/settings.ts'
import { PLUGIN_ID } from '../../src/shared/types.ts'

/** Field metadata of the plugin Config schema, as schemastery exposes it. */
function field(name: string): { volatile?: boolean; default?: unknown } {
  const schema = Config.dict?.[name]
  if (schema === undefined) throw new Error(`Config has no field "${name}"`)
  return schema.meta as { volatile?: boolean; default?: unknown }
}

/** A structural Cordis Host context recording the settings page policy. */
function fakeContext(options: { configureThrows?: boolean } = {}) {
  const fiber = { id: 'plugin-fiber' }
  const configureCalls: Array<{ auto?: boolean; owner: unknown }> = []
  const child = {
    settings: {
      configure(presentation: { auto?: boolean }, owner: unknown) {
        if (options.configureThrows === true) throw new Error('settings refused the policy')
        configureCalls.push({ ...presentation, owner })
        return () => {}
      },
    },
    effect(setup: () => (() => void) | void) {
      const dispose = setup()
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }
  const injectNames: string[][] = []
  const ctx = {
    fiber,
    inject(names: string[], callback: (payload: unknown) => void) {
      injectNames.push([...names])
      if (names.includes('settings')) callback(child)
      return () => {}
    },
  }
  return { ctx, fiber, configureCalls, injectNames }
}

describe('Host Config form (DSH 0.1.7 volatile projection)', () => {
  it('marks exactly the user preferences volatile', () => {
    const volatileFields = Object.entries(Config.dict ?? {})
      .filter(([, schema]) => schema.meta.volatile === true)
      .map(([name]) => name)
      .sort()
    expect(volatileFields).toEqual(['cacheTtlMinutes', 'channel', 'sidebarEnabled'])
  })

  it('keeps the deployment fields out of the form', () => {
    for (const name of ['cacheTtlHours', 'timeoutMs', 'autoCheckOnMount']) {
      expect(field(name).volatile, name).toBeUndefined()
    }
  })

  it('supplies the preference defaults the form shows on a fresh profile', () => {
    expect(field('sidebarEnabled').default).toBe(true)
    expect(field('channel').default).toBe('latest')
    expect(field('cacheTtlMinutes').default).toBe(360)
  })

  it('uses the Loader entry id as the storage namespace', () => {
    // The id in cordis.patch.yml IS the form namespace on 0.1.7; drifting from
    // PLUGIN_ID would silently detach the browser half from its storage.
    const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const id = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)?.[1]
    expect(id).toBe(PLUGIN_ID)
  })
})

describe('settings page policy', () => {
  it('suppresses the auto-generated page for this entry', () => {
    const fake = fakeContext()
    installSettings(fake.ctx as never)
    expect(fake.injectNames).toEqual([['settings']])
    expect(fake.configureCalls).toEqual([{ auto: false, owner: fake.fiber }])
  })

  it('stays inert when the settings service is absent', () => {
    // Without a settings provider the inject callback never runs, so the plugin
    // keeps working from its defaults and registers no policy at all.
    const calls: string[] = []
    const ctx = {
      fiber: { id: 'plugin-fiber' },
      inject(names: string[], _callback: (payload: unknown) => void) {
        calls.push(names.join(','))
        return () => {}
      },
    }
    expect(() => { installSettings(ctx as never) }).not.toThrow()
    expect(calls).toEqual(['settings'])
  })

  it('contains a refused policy registration instead of taking the plugin down', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fake = fakeContext({ configureThrows: true })
      expect(() => { installSettings(fake.ctx as never) }).not.toThrow()
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})
