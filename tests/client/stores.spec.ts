import { describe, expect, it } from 'vitest'
import { PanelStore, PreferencesStore, StatusStore } from '../../src/client/stores.ts'

const status = {
  currentVersion: '0.1.2-rc.1',
  latestVersion: '0.1.2',
  hasUpdate: true,
  cached: false,
  checkedAt: '2026-01-01T00:00:00.000Z',
  warning: null,
  installKind: 'npm-global' as const,
  upgradeCommand: 'npm install -g @deepseek-ai/dsh@latest',
  releaseUrl: 'https://example.test/releases',
  changelogUrl: 'https://example.test/releases',
  publishedAt: null,
  packageName: '@deepseek-ai/dsh',
  channel: 'latest' as const,
  channels: [
    { channel: 'latest' as const, version: '0.1.2', publishedAt: null, compatibility: 'unverified' as const },
    { channel: 'next' as const, version: '0.1.2', publishedAt: null, compatibility: 'unverified' as const },
    { channel: 'alpha' as const, version: '0.1.5-alpha.2', publishedAt: null, compatibility: 'unverified' as const },
  ],
  canApplyInPlace: false as const,
}

describe('StatusStore access boundary', () => {
  it('uses cached read first and force only for a manual refresh', async () => {
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
    const store = new StatusStore({
      rpc: {
        call: async (channel, endpoint, payload) => {
          calls.push({ channel, endpoint, payload })
          const selected = (payload as { channel: 'latest' | 'next' | 'alpha' }).channel
          const release = status.channels.find(item => item.channel === selected)
          return { ok: true, value: {
            ...status,
            channel: selected,
            latestVersion: release?.version ?? null,
            upgradeCommand: `npm install -g @deepseek-ai/dsh@${selected}`,
          } }
        },
      },
    })

    await store.load()
    await store.selectChannel('alpha')
    await store.refresh('alpha')

    expect(calls).toEqual([
      { channel: '/dsh-update-status', endpoint: 'get-status', payload: { channel: 'latest' } },
      { channel: '/dsh-update-status', endpoint: 'get-status', payload: { channel: 'alpha' } },
      { channel: '/dsh-update-status', endpoint: 'check-update', payload: { force: true, channel: 'alpha' } },
    ])
    expect(store.getSnapshot()).toMatchObject({ status: { channel: 'alpha', latestVersion: '0.1.5-alpha.2' }, loading: false, error: null })
  })

  it('re-projects a persisted channel that arrives during the initial read', async () => {
    const calls: unknown[] = []
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const store = new StatusStore({ rpc: { call: async (_channel, _endpoint, payload) => {
      calls.push(payload)
      const requested = (payload as { channel: 'latest' | 'alpha' }).channel
      if (requested === 'latest') await waiting
      return { ok: true, value: requested === 'alpha' ? {
        ...status,
        channel: 'alpha',
        latestVersion: '0.1.5-alpha.2',
        upgradeCommand: 'npm install -g @deepseek-ai/dsh@alpha',
      } : status }
    } } })

    const initial = store.load()
    const selected = store.selectChannel('alpha')
    release()
    await Promise.all([initial, selected])

    expect(calls).toEqual([{ channel: 'latest' }, { channel: 'alpha' }])
    expect(store.getSnapshot().status).toMatchObject({ channel: 'alpha', latestVersion: '0.1.5-alpha.2' })
  })

  it('honors the newest requested projection after rapid channel changes', async () => {
    const calls: string[] = []
    let releaseAlpha!: () => void
    const alphaWaiting = new Promise<void>(resolve => { releaseAlpha = resolve })
    const store = new StatusStore({ rpc: { call: async (_channel, _endpoint, payload) => {
      const selected = (payload as { channel: 'latest' | 'next' | 'alpha' }).channel
      calls.push(selected)
      if (selected === 'alpha') await alphaWaiting
      const release = status.channels.find(item => item.channel === selected)
      return { ok: true, value: { ...status, channel: selected, latestVersion: release?.version ?? null } }
    } } })

    await store.load()
    const alpha = store.selectChannel('alpha')
    const next = store.selectChannel('next')
    releaseAlpha()
    await Promise.all([alpha, next])

    expect(calls).toEqual(['latest', 'alpha', 'next'])
    expect(store.getSnapshot().status?.channel).toBe('next')
  })

  it('does not retry a failed channel projection in a loop', async () => {
    let calls = 0
    const store = new StatusStore({ rpc: { call: async () => {
      calls += 1
      return { ok: false, error: { message: 'projection unavailable' } }
    } } })

    await store.selectChannel('alpha')
    expect(calls).toBe(1)
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: 'projection unavailable' })
  })

  it('keeps a non-loopback/static client local and never calls the Host channel', async () => {
    let calls = 0
    const store = new StatusStore({
      rpc: {
        call: async () => {
          calls += 1
          return { ok: true, value: status }
        },
      },
    }, '0.1.2-rc.1')

    expect(store.getSnapshot()).toMatchObject({
      status: { currentVersion: '0.1.2-rc.1', latestVersion: null, canApplyInPlace: false },
      loading: false,
      error: null,
    })
    await store.load()
    await store.refresh()
    expect(calls).toBe(0)
  })
})

describe('PreferencesStore release channel', () => {
  it('persists an in-panel channel choice through the settings scope', async () => {
    const calls: Array<[string, unknown]> = []
    let snapshot = { status: 'ready', writable: true, value: { sidebarEnabled: true, channel: 'latest' } }
    const listeners = new Set<() => void>()
    const scope = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, value: unknown) => {
        calls.push([field, value])
        snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } }
        for (const listener of listeners) listener()
      },
    }
    const store = new PreferencesStore()
    store.attach(scope)

    store.setChannel('alpha')
    await Promise.resolve()

    expect(calls).toEqual([['channel', 'alpha']])
    expect(store.getSnapshot()).toMatchObject({ channel: 'alpha', writable: true })
  })
})

describe('PanelStore trigger origin', () => {
  it('retains the active trigger and closes only on a second same-trigger action', () => {
    const store = new PanelStore()
    expect(store.getSnapshot()).toEqual({ open: false, origin: 'brand' })

    store.toggle('brand')
    expect(store.getSnapshot()).toEqual({ open: true, origin: 'brand' })

    store.toggle('rail')
    expect(store.getSnapshot()).toEqual({ open: true, origin: 'rail' })

    store.toggle('rail')
    expect(store.getSnapshot()).toEqual({ open: false, origin: 'rail' })

    store.close()
    expect(store.getSnapshot()).toEqual({ open: false, origin: 'rail' })
  })
})
