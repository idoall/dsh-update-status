import { describe, expect, it } from 'vitest'
import { PanelStore, PreferencesStore, RestartStore, StatusStore } from '../../src/client/stores.ts'
import type { SettingsScopeSnapshotLike } from '../../src/client/settings/scopeFaces.ts'

const status = {
  currentVersion: '0.2.0-rc.2', latestVersion: '0.2.1-alpha.1', hasUpdate: true,
  compatibility: 'unverified' as const, cached: false, checkedAt: '2026-01-01T00:00:00.000Z', warning: null, warnings: [],
  installKind: 'npm-global' as const, upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
  releaseUrl: 'https://example.test/releases', changelogUrl: 'https://example.test/releases', publishedAt: null,
  packageName: '@deepseek-ai/dsh', canApplyInPlace: false as const,
}

describe('StatusStore access boundary', () => {
  it('uses cached read first and force only for a manual refresh', async () => {
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
    const store = new StatusStore({ rpc: { call: async (channel, endpoint, payload) => { calls.push({ channel, endpoint, payload }); return { ok: true, value: status } } } })
    await store.load(); await store.refresh()
    expect(calls).toEqual([
      { channel: '/api', endpoint: 'dsh-update-status.get-status', payload: { cacheTtlMinutes: 360 } },
      { channel: '/api', endpoint: 'dsh-update-status.check-update', payload: { force: true, cacheTtlMinutes: 360 } },
    ])
  })

  it('uses stored policy, coalesces requests, and reports unavailable transport', async () => {
    const payloads: unknown[] = []
    const store = new StatusStore({ rpc: { call: async (_channel, _endpoint, payload) => { payloads.push(payload); return { ok: true, value: status } } } })
    await store.load(30); await store.refresh(90)
    expect(payloads).toEqual([{ cacheTtlMinutes: 30 }, { force: true, cacheTtlMinutes: 90 }])
    const unavailable = new StatusStore({}); await unavailable.load()
    expect(unavailable.getSnapshot().error).toBe('DSH connection RPC is unavailable')
  })
})

describe('RestartStore recovery boundary', () => {
  const supervised = { instanceId: 'old', available: true, supervisor: 'launchd', unavailableReason: null }

  it('is idle until capability is read and never polls merely by mounting', async () => {
    const calls: string[] = []
    const store = new RestartStore({ rpc: { call: async (_channel, endpoint) => { calls.push(endpoint); return { ok: true, value: supervised } } } }, { schedule: () => 1, cancel: () => {} })
    expect(store.getSnapshot().phase).toBe('unknown')
    await store.refresh()
    expect(calls).toEqual(['dsh-update-status.restart-status'])
    expect(store.getSnapshot().phase).toBe('idle')
  })

  it('checks activity, demands force only after listing active work, and sends expected identity', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const active = { kind: 'active-work', status: supervised, activity: { hasActive: true, items: [{ type: 'agent', id: 'a1', label: 'a1', status: 'running' }] } }
    const store = new RestartStore({ rpc: { call: async (_channel, endpoint, payload) => {
      calls.push({ endpoint, payload })
      return endpoint === 'dsh-update-status.restart-check' ? { ok: true, value: active } : { ok: true, value: { kind: 'scheduled', instanceId: 'old' } }
    } } }, { schedule: () => 1, cancel: () => {} })
    await store.refresh(); await store.check()
    expect(store.getSnapshot()).toMatchObject({ phase: 'armed', activity: [{ type: 'agent', id: 'a1' }] })
    await store.request(true)
    expect(calls.at(-1)).toEqual({ endpoint: 'dsh-update-status.restart', payload: { force: true, expectedInstanceId: 'old' } })
  })

  it('reloads exactly once only after a distinct Host instance id', async () => {
    const timers: Array<() => void> = []
    let statusCalls = 0
    let reloads = 0
    const store = new RestartStore({ rpc: { call: async (_channel, endpoint) => {
      if (endpoint === 'dsh-update-status.restart-status') {
        statusCalls += 1
        // refresh() consumes the first read; the first recovery poll must still
        // see the old process, and only the second recovery poll sees the new one.
        return { ok: true, value: statusCalls <= 2 ? supervised : { ...supervised, instanceId: 'new' } }
      }
      if (endpoint === 'dsh-update-status.restart-check') return { ok: true, value: { kind: 'ready', status: supervised } }
      return { ok: true, value: { kind: 'scheduled', instanceId: 'old' } }
    } } }, {
      schedule: callback => { timers.push(callback); return timers.length }, cancel: () => {},
      requestTimeout: () => 0, cancelRequestTimeout: () => {}, liveness: async () => false,
      reload: () => { reloads += 1 },
    })
    await store.refresh(); await store.check(); await store.request(false)
    expect(reloads).toBe(0)
    // First recovery status is the same process — no false success.
    timers.shift()?.(); await Promise.resolve(); await Promise.resolve()
    expect(reloads).toBe(0)
    // The next scheduled recovery sees the new process identity.
    timers.shift()?.(); await Promise.resolve(); await Promise.resolve()
    expect(reloads).toBe(1)
  })
})

describe('PreferencesStore', () => {
  function scope(initial: Record<string, unknown>) {
    const calls: Array<[string, unknown]> = []
    let snapshot: SettingsScopeSnapshotLike = { status: 'ready', value: { ...initial }, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }
    const listeners = new Set<() => void>()
    return {
      calls,
      scope: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        set: async (field: string, value: unknown) => { calls.push([field, value]); snapshot = { ...snapshot, value: { ...(snapshot.value as Record<string, unknown>), [field]: value } }; for (const listener of listeners) listener() },
      },
    }
  }

  it('persists only recognized preferences and ignores a retired channel', async () => {
    const { calls, scope: fake } = scope({ sidebarEnabled: true, cacheTtlMinutes: 360, channel: 'next' })
    const store = new PreferencesStore(); store.attach(fake)
    store.setSidebarEnabled(false); store.setCacheTtlMinutes(30); await Promise.resolve()
    expect(calls).toEqual([['sidebarEnabled', false], ['cacheTtlMinutes', 30]])
    expect('channel' in store.getSnapshot()).toBe(false)
  })
})

describe('PanelStore', () => {
  it('toggles open state and closes idempotently', () => {
    const store = new PanelStore()
    store.toggle(); expect(store.getSnapshot()).toEqual({ open: true })
    store.close(); expect(store.getSnapshot()).toEqual({ open: false })
  })
})
