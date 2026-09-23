/**
 * dsh-update-status — settings channel specs.
 *
 * Locks the LAN fix: on a non-loopback page DSH's official settings form
 * (`ctx.configForms`, the DSH 0.1.7 successor of the removed `settingsScope`
 * service) is deliberately `unavailable` (documented "Non-loopback pages get no
 * durable settings"), and the plugin's preferences must still reach their ONE
 * source of truth — the Host `dsh-update-status` entry — through the direct
 * channel. The `configFormScope` specs below additionally lock the projection
 * of that official form onto the plugin's own scope contract, including the
 * refused-write → rejection translation.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createHostDirectScope,
  settingsInvalidationsOf,
  settingsRemoteFace,
  settingsRemoteOf,
  SettingsWriteFailure,
  type SettingsNamespaceViewLike,
  type SettingsRemoteLike,
  type SettingsRemoteOutcome,
} from '../../src/client/settings/hostDirectScope.ts'
import { createSettingsChannel } from '../../src/client/settings/settingsChannel.ts'
import { PreferencesStore } from '../../src/client/stores.ts'
import { configFormScope, configFormsOf, type ConfigFormLike } from '../../src/client/settings/configFormScope.ts'
import type {
  SettingsPathOpLike,
  SettingsScopeLike,
  SettingsScopeSnapshotLike,
} from '../../src/client/settings/scopeFaces.ts'

const NS = 'dsh-update-status'

interface Row {
  ns: string
  value: unknown
  base?: unknown
  user?: unknown
  revision: number
}

/** Let every pending microtask/timer hop of a wire round-trip settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const prefs = (over: Record<string, unknown> = {}) => ({
  sidebarEnabled: true,
  channel: 'latest',
  cacheTtlMinutes: 360,
  ...over,
})

/** Fake `remote.settings` face with observable calls and injectable failures. */
function makeRemote(initial: { writable?: boolean; rows?: Row[] } = {}) {
  let writable = initial.writable ?? true
  let rows: Row[] = initial.rows ?? [{ ns: NS, value: prefs(), revision: 1 }]
  let describeFailure: { message: string } | undefined
  let mutateFailure: { code: string; message?: string } | undefined
  const describeCalls: number[] = []
  const mutateCalls: Array<{ ns: string; ops: readonly SettingsPathOpLike[]; expectedRevision?: number }> = []

  const remote: SettingsRemoteLike = {
    async describe(): Promise<SettingsRemoteOutcome<{ writable: boolean; hasDocument: boolean; namespaces: Row[] }>> {
      describeCalls.push(describeCalls.length + 1)
      if (describeFailure !== undefined) return { ok: false, error: { ...describeFailure } }
      return {
        ok: true,
        value: { writable, hasDocument: true, namespaces: rows.map(row => ({ ...row })) },
      }
    },
    async mutate(
      ns: string,
      ops: readonly SettingsPathOpLike[],
      expectedRevision?: number,
    ): Promise<SettingsRemoteOutcome<SettingsNamespaceViewLike>> {
      mutateCalls.push(expectedRevision === undefined ? { ns, ops } : { ns, ops, expectedRevision })
      if (mutateFailure !== undefined) return { ok: false, error: { ...mutateFailure } }
      const row = rows.find(candidate => candidate.ns === ns)
      if (row === undefined) return { ok: false, error: { code: 'settings/unknown-namespace' } }
      if (expectedRevision !== undefined && expectedRevision !== row.revision) {
        return { ok: false, error: { code: 'settings/conflict', message: 'stale revision' } }
      }
      for (const op of ops) {
        if (op.op === 'set' && typeof op.path[0] === 'string') {
          row.value = { ...(row.value as Record<string, unknown>), [op.path[0]]: op.value }
        }
      }
      row.revision += 1
      return { ok: true, value: { ...row } }
    },
  }

  return {
    remote,
    describeCalls,
    mutateCalls,
    setRows(next: Row[]) { rows = next },
    rows: () => rows,
    setWritable(next: boolean) { writable = next },
    failDescribe(message?: string) { describeFailure = { message: message ?? 'describe refused' } },
    healDescribe() { describeFailure = undefined },
    failMutate(code: string, message?: string) { mutateFailure = message === undefined ? { code } : { code, message } },
    healMutate() { mutateFailure = undefined },
  }
}

/** Fake official settings form (`ctx.configForms.get(entryId)` answers with it). */
function makeOfficial(initial: Partial<SettingsScopeSnapshotLike> = {}) {
  const snap: SettingsScopeSnapshotLike = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
    ...initial,
  }
  const listeners = new Set<() => void>()
  const writes: Array<{ field: string; value: unknown }> = []
  const scope: SettingsScopeLike = {
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async set(field, value) { writes.push({ field, value }) },
  }
  return {
    scope,
    snap,
    writes,
    set(next: Partial<SettingsScopeSnapshotLike>) {
      Object.assign(snap, next)
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A structural stand-in for the official `ConfigForm<T>` (snapshot + write queue). */
function makeConfigForm(initial: Partial<SettingsScopeSnapshotLike> = {}, accepted = true) {
  const snap: SettingsScopeSnapshotLike = {
    status: 'ready',
    value: prefs(),
    base: prefs(),
    user: {},
    revision: 1,
    writable: true,
    mode: 'host',
    ...initial,
  }
  const listeners = new Set<() => void>()
  const sets: Array<{ field: string; value: unknown }> = []
  let answer = accepted
  let fault: Error | undefined
  const form: ConfigFormLike = {
    getSnapshot: () => ({ ...snap }),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async set(field, value) {
      sets.push({ field, value })
      if (fault !== undefined) throw fault
      return answer
    },
  }
  return {
    form,
    sets,
    snap,
    refuse() { answer = false },
    fail(error: Error) { fault = error },
    set(next: Partial<SettingsScopeSnapshotLike>) {
      Object.assign(snap, next)
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('hostDirectScope (non-loopback Host settings channel)', () => {
  it('derives the official per-namespace snapshot shape from the namespace row', async () => {
    const remote = makeRemote({
      rows: [{ ns: NS, value: prefs({ channel: 'next' }), base: prefs(), user: prefs({ channel: 'next' }), revision: 7 }],
    })
    const scope = createHostDirectScope(remote.remote, NS)
    await scope.load()
    expect(scope.getSnapshot()).toEqual({
      status: 'ready',
      value: prefs({ channel: 'next' }),
      base: prefs(),
      user: prefs({ channel: 'next' }),
      revision: 7,
      writable: true,
      mode: 'host',
    })
    expect(remote.describeCalls).toHaveLength(1)
  })

  it('is unavailable (with the document writability) when the Host serves no such namespace', async () => {
    const remote = makeRemote({ writable: false, rows: [{ ns: 'other', value: {}, revision: 3 }] })
    const scope = createHostDirectScope(remote.remote, NS)
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', value: undefined, writable: false, mode: 'host' })
  })

  it('a refused read publishes unavailable but NEVER discards a held document', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs({ channel: 'next' }), revision: 2 }] })
    const scope = createHostDirectScope(remote.remote, NS)
    await scope.load()
    expect(scope.getSnapshot().status).toBe('ready')

    remote.failDescribe('boom')
    await scope.load()
    // The held document stays authoritative for the next write fence…
    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', revision: 2 })
    expect(scope.lastError()).toBe('boom')

    remote.healDescribe()
    await scope.load()
    expect(scope.lastError()).toBeUndefined()
  })

  it('reports unavailable when the very first read is refused (no fabricated state)', async () => {
    const remote = makeRemote()
    remote.failDescribe('offline')
    const scope = createHostDirectScope(remote.remote, NS)
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', value: undefined })
    expect(scope.lastError()).toBe('offline')
  })

  it('set sends one field op under the revision fence and folds the answer without a second read', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs(), revision: 4 }] })
    const scope = createHostDirectScope(remote.remote, NS)
    await scope.load()
    await scope.set('channel', 'next')
    expect(remote.mutateCalls).toEqual([
      { ns: NS, ops: [{ op: 'set', path: ['channel'], value: 'next' }], expectedRevision: 4 },
    ])
    expect(remote.describeCalls).toHaveLength(1) // folded, not re-read
    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', revision: 5, writable: true })
    expect(scope.getSnapshot().value).toEqual(prefs({ channel: 'next' }))
  })

  it('a refused write REJECTS with the Host code and re-syncs the authoritative document', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs(), revision: 4 }] })
    const scope = createHostDirectScope(remote.remote, NS)
    await scope.load()

    // Another device moved the namespace ahead: the fence is refused.
    remote.setRows([{ ns: NS, value: prefs({ channel: 'alpha' }), revision: 9 }])
    const failure = await scope.set('channel', 'next').then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(SettingsWriteFailure)
    expect((failure as SettingsWriteFailure).code).toBe('settings/conflict')
    expect(remote.describeCalls).toHaveLength(2) // recovery read
    expect(scope.getSnapshot()).toMatchObject({ revision: 9 })
    expect(scope.getSnapshot().value).toEqual(prefs({ channel: 'alpha' }))
  })

  it('serializes queued writes in issue order', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs(), revision: 1 }] })
    const scope = createHostDirectScope(remote.remote, NS)
    await scope.load()
    let inFlight = 0
    let maxInFlight = 0
    const order: string[] = []
    const originalMutate = remote.remote.mutate.bind(remote.remote)
    remote.remote.mutate = async (ns, ops, revision) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      order.push(`start:${String((ops[0] as { value?: unknown }).value)}`)
      await new Promise(resolve => setTimeout(resolve, 5))
      const outcome = await originalMutate(ns, ops, revision)
      inFlight -= 1
      order.push(`end:${String((ops[0] as { value?: unknown }).value)}`)
      return outcome
    }
    await Promise.all([scope.set('channel', 'first'), scope.set('channel', 'second')])
    expect(maxInFlight).toBe(1)
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })

  it('stops notifying after dispose', async () => {
    const remote = makeRemote()
    const scope = createHostDirectScope(remote.remote, NS)
    const listener = vi.fn()
    scope.subscribe(listener)
    scope.dispose()
    await scope.load()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('settingsRemoteOf / settingsInvalidationsOf guards', () => {
  it('reads the LITERAL injected service key first and still accepts the nested payload shape', () => {
    const remote = makeRemote().remote
    expect(settingsRemoteOf({ 'remote.settings': remote })).toBe(remote)
    expect(settingsRemoteOf({ remote: { settings: remote } })).toBe(remote)
    expect(settingsRemoteFace(remote)).toBe(remote)
    expect(settingsRemoteOf({ remote: { settings: { describe: () => undefined } } })).toBeUndefined()
    expect(settingsRemoteOf({ remote: {} })).toBeUndefined()
    expect(settingsRemoteOf(undefined)).toBeUndefined()
    expect(settingsRemoteOf('remote.settings')).toBeUndefined()
    expect(settingsRemoteFace(undefined)).toBeUndefined()
    expect(settingsRemoteFace({ describe: () => undefined })).toBeUndefined()
  })

  it('never throws when the injected context REFUSES the dotted parent (LAN wiring regression)', () => {
    const remote = makeRemote().remote
    // What a real `ctx.inject(['remote.settings'], …)` payload does: the dotted
    // parent is not injected, so reading it throws.
    const payload = {
      'remote.settings': remote,
      get remote(): never {
        throw new Error('cannot get property "remote" without inject')
      },
    }
    expect(settingsRemoteOf(payload)).toBe(remote)

    const withoutLiteral = {
      get remote(): never {
        throw new Error('cannot get property "remote" without inject')
      },
    }
    expect(() => settingsRemoteOf(withoutLiteral)).not.toThrow()
    expect(settingsRemoteOf(withoutLiteral)).toBeUndefined()
  })

  it('subscribes to the Host settings invalidation on the Remote service and returns its disposer', () => {
    const dispose = vi.fn()
    const on = vi.fn(() => dispose)
    const subscribe = settingsInvalidationsOf({ $on: on })
    expect(typeof subscribe).toBe('function')
    const off = subscribe!(vi.fn())
    expect(on).toHaveBeenCalledWith('settings/document-updated', expect.any(Function))
    expect(off).toBe(dispose)
    expect(settingsInvalidationsOf({})).toBeUndefined()
    expect(settingsInvalidationsOf(undefined)).toBeUndefined()
  })
})

describe('configFormsOf guard', () => {
  it('accepts only a face exposing get() and never throws on a refusing payload', () => {
    const face = { get: () => makeConfigForm().form }
    expect(configFormsOf({ configForms: face })).toBe(face)
    expect(configFormsOf({ configForms: {} })).toBeUndefined()
    expect(configFormsOf({})).toBeUndefined()
    expect(configFormsOf(undefined)).toBeUndefined()
    expect(configFormsOf('configForms')).toBeUndefined()

    // A real injected payload proxy refuses a member read; the guard contains it.
    const refusing = {
      get configForms(): never {
        throw new Error('cannot get property "configForms" without inject')
      },
    }
    expect(() => configFormsOf(refusing)).not.toThrow()
    expect(configFormsOf(refusing)).toBeUndefined()
  })
})

describe('configFormScope (official form → plugin scope contract)', () => {
  it('projects the official form snapshot field by field', () => {
    const official = makeConfigForm({
      status: 'ready',
      value: prefs({ channel: 'next' }),
      base: prefs(),
      user: prefs({ channel: 'next' }),
      revision: 7,
      writable: true,
      mode: 'host',
    })
    expect(configFormScope(official.form).getSnapshot()).toEqual({
      status: 'ready',
      value: prefs({ channel: 'next' }),
      base: prefs(),
      user: prefs({ channel: 'next' }),
      revision: 7,
      writable: true,
      mode: 'host',
    })
  })

  it('forwards subscribe to the form', () => {
    const official = makeConfigForm()
    const scope = configFormScope(official.form)
    const listener = vi.fn()
    const off = scope.subscribe(listener)
    official.set({ revision: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    official.set({ revision: 3 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('resolves a set the Host accepted and passes the field op through unchanged', async () => {
    const official = makeConfigForm()
    await configFormScope(official.form).set('channel', 'alpha')
    expect(official.sets).toEqual([{ field: 'channel', value: 'alpha' }])
  })

  it('translates a refused set (false) into a conflict rejection', async () => {
    // The settings page must surface a conflict instead of pretending the edit
    // landed; the form has already re-read the authoritative value.
    const official = makeConfigForm()
    official.refuse()
    const failure = await configFormScope(official.form).set('channel', 'alpha')
      .then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(SettingsWriteFailure)
    expect((failure as SettingsWriteFailure).code).toBe('settings/conflict')
  })

  it('translates a transport fault into an unreachable rejection', async () => {
    const official = makeConfigForm()
    official.fail(new Error('socket closed'))
    const failure = await configFormScope(official.form).set('channel', 'alpha')
      .then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(SettingsWriteFailure)
    expect((failure as SettingsWriteFailure).code).toBe('settings/unreachable')
    expect((failure as SettingsWriteFailure).message).toBe('socket closed')
  })
})

describe('settingsChannel (official form vs direct Host channel)', () => {
  it('stays loading while no channel has answered', () => {
    const channel = createSettingsChannel({ openDirect: () => undefined })
    expect(channel.getSnapshot().status).toBe('loading')
  })

  it('keeps the official scope whenever it is not unavailable, and never opens the direct channel', () => {
    const official = makeOfficial({ status: 'ready', value: prefs({ channel: 'next' }), writable: true, revision: 3 })
    const openDirect = vi.fn(() => {
      throw new Error('the direct channel must not open on a loopback page')
    })
    const channel = createSettingsChannel({ openDirect })
    channel.setOfficial(official.scope)
    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', revision: 3 })
    expect(openDirect).not.toHaveBeenCalled()

    official.set({ revision: 4 })
    expect(channel.getSnapshot().revision).toBe(4)
  })

  it('falls back to the direct Host channel when the official scope reports unavailable (the LAN page)', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs({ channel: 'next' }), revision: 11 }] })
    const official = makeOfficial({ status: 'unavailable', writable: false, mode: 'memory' })
    const channel = createSettingsChannel({ openDirect: () => createHostDirectScope(remote.remote, NS) })
    channel.setOfficial(official.scope)
    // The direct channel is opened lazily and answers asynchronously.
    expect(channel.getSnapshot().status).toBe('loading')
    await flush()
    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', revision: 11, mode: 'host', writable: true })
    expect(channel.getSnapshot().value).toEqual(prefs({ channel: 'next' }))
  })

  it('opens the direct channel when it appears after the official scope (injection order)', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs({ channel: 'alpha' }), revision: 2 }] })
    const official = makeOfficial({ status: 'unavailable', mode: 'memory' })
    let available = false
    const channel = createSettingsChannel({
      openDirect: () => (available ? createHostDirectScope(remote.remote, NS) : undefined),
    })
    channel.setOfficial(official.scope)
    expect(channel.getSnapshot().status).toBe('unavailable')

    available = true
    channel.refresh()
    await flush()
    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', mode: 'host' })
    expect(channel.getSnapshot().value).toEqual(prefs({ channel: 'alpha' }))
  })

  it('hands authority back to the official scope once it stops being unavailable', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs({ channel: 'alpha' }), revision: 5 }] })
    const official = makeOfficial({ status: 'unavailable', mode: 'memory' })
    const channel = createSettingsChannel({ openDirect: () => createHostDirectScope(remote.remote, NS) })
    channel.setOfficial(official.scope)
    await flush()
    expect(channel.getSnapshot().revision).toBe(5)

    official.set({ status: 'ready', value: prefs({ channel: 'next' }), writable: true, revision: 6 })
    expect(channel.getSnapshot()).toMatchObject({ revision: 6 })
    expect((channel.getSnapshot().value as { channel: string }).channel).toBe('next')
  })

  it('routes writes to the active channel and refuses with no channel at all', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs(), revision: 1 }] })
    const official = makeOfficial({ status: 'unavailable', mode: 'memory' })
    const channel = createSettingsChannel({ openDirect: () => createHostDirectScope(remote.remote, NS) })
    channel.setOfficial(official.scope)
    await flush()
    await channel.set('channel', 'next')
    expect(remote.mutateCalls).toHaveLength(1)
    expect(official.writes).toHaveLength(0)

    const empty = createSettingsChannel({ openDirect: () => undefined })
    await expect(empty.set('channel', 'next')).rejects.toThrow('settings channel is unavailable')
  })

  it('routes a loopback write through the official scope, untouched', async () => {
    const official = makeOfficial({ status: 'ready', value: prefs(), writable: true, revision: 2 })
    const openDirect = vi.fn(() => undefined)
    const channel = createSettingsChannel({ openDirect })
    channel.setOfficial(official.scope)
    await channel.set('sidebarEnabled', false)
    expect(official.writes).toEqual([{ field: 'sidebarEnabled', value: false }])
    expect(openDirect).not.toHaveBeenCalled()
  })

  it('routes a loopback page through the projected configFormScope end to end', async () => {
    // The real loopback wiring: `ctx.configForms.get(entryId)` projected by
    // configFormScope. A ready form wins, the direct channel never opens, and a
    // refused write surfaces as a conflict rather than a silent success.
    const official = makeConfigForm({ value: prefs({ channel: 'next' }), revision: 4 })
    const openDirect = vi.fn(() => undefined)
    const channel = createSettingsChannel({ openDirect })
    channel.setOfficial(configFormScope(official.form))
    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', revision: 4 })
    expect((channel.getSnapshot().value as { channel: string }).channel).toBe('next')

    await channel.set('channel', 'alpha')
    expect(official.sets).toEqual([{ field: 'channel', value: 'alpha' }])
    expect(openDirect).not.toHaveBeenCalled()

    official.refuse()
    await expect(channel.set('channel', 'latest')).rejects.toBeInstanceOf(SettingsWriteFailure)
  })

  it('falls back to the direct channel when the official form is pinned to memory (LAN)', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs({ channel: 'alpha' }), revision: 8 }] })
    const official = makeConfigForm({ status: 'unavailable', value: undefined, writable: false, mode: 'memory', revision: undefined })
    const channel = createSettingsChannel({ openDirect: () => createHostDirectScope(remote.remote, NS) })
    channel.setOfficial(configFormScope(official.form))
    await flush()
    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', revision: 8, mode: 'host', writable: true })
  })

  it('reload() refreshes the direct channel through the invalidation seam', async () => {
    const remote = makeRemote({ rows: [{ ns: NS, value: prefs(), revision: 1 }] })
    const official = makeOfficial({ status: 'unavailable', mode: 'memory' })
    const channel = createSettingsChannel({ openDirect: () => createHostDirectScope(remote.remote, NS) })
    channel.setOfficial(official.scope)
    await flush()
    expect(remote.describeCalls).toHaveLength(1)

    remote.setRows([{ ns: NS, value: prefs({ channel: 'next' }), revision: 2 }])
    channel.reload()
    await flush()
    expect(remote.describeCalls).toHaveLength(2)
    expect(channel.getSnapshot().revision).toBe(2)
  })
})

describe('LAN regression: preferences are usable on a non-loopback page', () => {
  it('becomes ready, editable and writable over the direct Host channel', async () => {
    const remote = makeRemote({
      rows: [{ ns: NS, value: prefs({ channel: 'next', cacheTtlMinutes: 120 }), revision: 21 }],
    })
    // Exactly what DSH answers on a LAN page: an inert, process-local scope.
    const official = makeOfficial({ status: 'unavailable', writable: false, mode: 'memory' })
    const channel = createSettingsChannel({ openDirect: () => createHostDirectScope(remote.remote, NS) })
    const preferences = new PreferencesStore()

    channel.setOfficial(official.scope)
    preferences.attach(channel)
    expect(preferences.getSnapshot()).toMatchObject({ status: 'loading', writable: false })

    await flush()
    // The host's configured channel survives instead of silently falling back.
    expect(preferences.getSnapshot()).toMatchObject({
      status: 'ready',
      writable: true,
      sidebarEnabled: true,
      channel: 'next',
      cacheTtlMinutes: 120,
    })

    // And the settings page can persist an edit back to the shared Host document.
    preferences.setChannel('alpha')
    await flush()
    expect(remote.mutateCalls).toHaveLength(1)
    expect(remote.mutateCalls[0]!.ns).toBe(NS)
    expect(remote.mutateCalls[0]!.expectedRevision).toBe(21)
    expect(remote.mutateCalls[0]!.ops).toEqual([{ op: 'set', path: ['channel'], value: 'alpha' }])
  })
})
