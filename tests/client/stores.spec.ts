import { describe, expect, it } from 'vitest'
import { PanelStore, PreferencesStore, StatusStore } from '../../src/client/stores.ts'
import type { SettingsScopeSnapshotLike } from '../../src/client/settings/scopeFaces.ts'

const status = {
  currentVersion: '0.2.0-rc.2',
  latestVersion: '0.2.1-alpha.1',
  hasUpdate: true,
  compatibility: 'unverified' as const,
  cached: false,
  checkedAt: '2026-01-01T00:00:00.000Z',
  warning: null,
  warnings: [],
  installKind: 'npm-global' as const,
  upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
  releaseUrl: 'https://example.test/releases',
  changelogUrl: 'https://example.test/releases',
  publishedAt: null,
  packageName: '@deepseek-ai/dsh',
  canApplyInPlace: false as const,
}

describe('StatusStore access boundary', () => {
  it('uses cached read first and force only for a manual refresh', async () => {
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
    const store = new StatusStore({
      rpc: {
        call: async (channel, endpoint, payload) => {
          calls.push({ channel, endpoint, payload })
          return { ok: true, value: status }
        },
      },
    })

    await store.load()
    await store.refresh()

    expect(calls).toEqual([
      { channel: '/api', endpoint: 'dsh-update-status.get-status', payload: { cacheTtlMinutes: 360 } },
      { channel: '/api', endpoint: 'dsh-update-status.check-update', payload: { force: true, cacheTtlMinutes: 360 } },
    ])
    expect(store.getSnapshot()).toMatchObject({ status: { latestVersion: '0.2.1-alpha.1' }, loading: false, error: null })
  })

  it('sends the cache policy the user set, not the default', async () => {
    const payloads: unknown[] = []
    const store = new StatusStore({ rpc: { call: async (_channel, _endpoint, payload) => {
      payloads.push(payload)
      return { ok: true, value: status }
    } } })

    await store.load(30)
    await store.refresh(90)
    expect(payloads).toEqual([{ cacheTtlMinutes: 30 }, { force: true, cacheTtlMinutes: 90 }])
  })

  it('falls back to the default cache policy when the caller passes a value out of range', async () => {
    const payloads: unknown[] = []
    const store = new StatusStore({ rpc: { call: async (_channel, _endpoint, payload) => {
      payloads.push(payload)
      return { ok: true, value: status }
    } } })

    await store.load(5)
    expect(payloads).toEqual([{ cacheTtlMinutes: 360 }])
  })

  it('does not start a second request while one is in flight', async () => {
    let calls = 0
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const store = new StatusStore({ rpc: { call: async () => {
      calls += 1
      await waiting
      return { ok: true, value: status }
    } } })

    const first = store.load()
    const second = store.refresh()
    release()
    await Promise.all([first, second])

    expect(calls).toBe(1)
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: null })
  })

  it('reports a failed read without retrying in a loop', async () => {
    let calls = 0
    const store = new StatusStore({ rpc: { call: async () => {
      calls += 1
      return { ok: false, error: { message: 'registry unavailable' } }
    } } })

    await store.load()
    expect(calls).toBe(1)
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: 'registry unavailable' })
  })

  it('reads the Host channel from a non-loopback page too (no client-side loopback gate)', async () => {
    let calls = 0
    const store = new StatusStore({
      rpc: {
        call: async () => {
          calls += 1
          return { ok: true, value: status }
        },
      },
    })

    // The LAN page a phone uses must start from an honest loading state, never a
    // fabricated "current version".
    expect(store.getSnapshot()).toMatchObject({ status: null, loading: true, error: null })
    await store.load()
    await store.refresh()
    expect(calls).toBe(2)
    expect(store.getSnapshot()).toMatchObject({
      status: { currentVersion: '0.2.0-rc.2', latestVersion: '0.2.1-alpha.1' },
      loading: false,
      error: null,
    })
  })

  it('keeps its slots alive when no transport exists at all', async () => {
    const store = new StatusStore({})
    await store.load()
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: 'DSH connection RPC is unavailable' })
  })
})

describe('PreferencesStore', () => {
  function scope(initial: Record<string, unknown>) {
    const calls: Array<[string, unknown]> = []
    let snapshot: SettingsScopeSnapshotLike = {
      status: 'ready',
      value: { ...initial },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
    }
    const listeners = new Set<() => void>()
    return {
      calls,
      scope: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        set: async (field: string, value: unknown) => {
          calls.push([field, value])
          const value0 = snapshot.value as Record<string, unknown>
          snapshot = { ...snapshot, value: { ...value0, [field]: value } }
          for (const listener of listeners) listener()
        },
      },
    }
  }

  it('persists the two surviving preferences through the settings scope', async () => {
    const { calls, scope: fake } = scope({ sidebarEnabled: true, cacheTtlMinutes: 360 })
    const store = new PreferencesStore()
    store.attach(fake)

    store.setSidebarEnabled(false)
    store.setCacheTtlMinutes(30)
    await Promise.resolve()

    expect(calls).toEqual([['sidebarEnabled', false], ['cacheTtlMinutes', 30]])
    expect(store.getSnapshot()).toMatchObject({ sidebarEnabled: false, cacheTtlMinutes: 30, writable: true })
  })

  it('ignores a retired channel preference still stored in the profile', () => {
    const { scope: fake } = scope({ sidebarEnabled: true, cacheTtlMinutes: 120, channel: 'next' })
    const store = new PreferencesStore()
    store.attach(fake)

    expect(store.getSnapshot()).toEqual({
      sidebarEnabled: true,
      cacheTtlMinutes: 120,
      writable: true,
      status: 'ready',
    })
    expect('channel' in store.getSnapshot()).toBe(false)
  })

  it('keeps the local default when the stored cache policy is out of range', async () => {
    const { scope: fake } = scope({ sidebarEnabled: true, cacheTtlMinutes: 5 })
    const store = new PreferencesStore()
    store.attach(fake)
    expect(store.getSnapshot().cacheTtlMinutes).toBe(360)

    // Out-of-range input never reaches the Host either.
    const { calls, scope: strict } = scope({ sidebarEnabled: true, cacheTtlMinutes: 360 })
    const second = new PreferencesStore()
    second.attach(strict)
    second.setCacheTtlMinutes(5)
    await Promise.resolve()
    expect(calls).toEqual([])
    expect(second.getSnapshot().cacheTtlMinutes).toBe(360)
  })
})

describe('PanelStore', () => {
  it('toggles open state and closes idempotently', () => {
    const store = new PanelStore()
    expect(store.getSnapshot()).toEqual({ open: false })

    store.toggle()
    expect(store.getSnapshot()).toEqual({ open: true })

    store.toggle()
    expect(store.getSnapshot()).toEqual({ open: false })

    store.toggle()
    store.close()
    expect(store.getSnapshot()).toEqual({ open: false })
  })
})
