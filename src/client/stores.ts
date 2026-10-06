/** Small observable stores shared by the independent sidebar and overlay slots. */

import { DEFAULT_CACHE_TTL_MINUTES, isCacheTtlMinutes, PLUGIN_ID, UPDATE_ENDPOINTS, UPDATE_STATUS_CHANNEL, type UpdateStatus } from '../shared/types.ts'
import type { ConnectionClient, Observable } from './contract.ts'
import { errorMessage, updateStatusOf } from './contract.ts'
import type { SettingsScopeLike } from './settings/scopeFaces.ts'

export interface StatusSnapshot {
  status: UpdateStatus | null
  loading: boolean
  error: string | null
}

const INITIAL_STATUS: StatusSnapshot = { status: null, loading: true, error: null }

export class StatusStore implements Observable<StatusSnapshot> {
  private snapshot: StatusSnapshot = INITIAL_STATUS
  private readonly listeners = new Set<() => void>()
  private inFlight: Promise<boolean> | undefined
  private stopped = false

  constructor(private readonly connection: ConnectionClient) {}

  getSnapshot = (): StatusSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** First mount reads the Host's cached status; it never starts a browser timer. */
  async load(cacheTtlMinutes: number = DEFAULT_CACHE_TTL_MINUTES): Promise<void> {
    await this.request(false, cacheTtlMinutes)
  }

  /** User gesture only: force the Host to bypass TTL (while retaining single-flight). */
  async refresh(cacheTtlMinutes: number = DEFAULT_CACHE_TTL_MINUTES): Promise<void> {
    await this.request(true, cacheTtlMinutes)
  }

  /**
   * Ordinary read that waits out an in-flight request first.
   *
   * Used once per mount, when the stored cache policy arrives after the first
   * read already started: joining that request would keep the default policy, so
   * the follow-up read has to come after it settles.
   */
  async reload(cacheTtlMinutes: number): Promise<void> {
    const pending = this.inFlight
    if (pending !== undefined) await pending
    if (this.stopped) return
    await this.request(false, cacheTtlMinutes)
  }

  stop(): void {
    this.stopped = true
    this.listeners.clear()
  }

  private publish(next: StatusSnapshot): void {
    if (this.stopped) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  private request(force: boolean, cacheTtlMinutes: number): Promise<boolean> {
    if (this.inFlight !== undefined) return this.inFlight
    const rpc = this.connection.rpc
    if (rpc === undefined || typeof rpc.call !== 'function') {
      this.publish({ ...this.snapshot, loading: false, error: 'DSH connection RPC is unavailable' })
      return Promise.resolve(false)
    }

    this.publish({ ...this.snapshot, loading: true, error: null })
    const run = (async () => {
      try {
        const endpoint = force ? UPDATE_ENDPOINTS.checkUpdate : UPDATE_ENDPOINTS.getStatus
        const ttl = isCacheTtlMinutes(cacheTtlMinutes) ? cacheTtlMinutes : DEFAULT_CACHE_TTL_MINUTES
        const raw = await rpc.call(UPDATE_STATUS_CHANNEL, endpoint, force
          ? { force: true, cacheTtlMinutes: ttl }
          : { cacheTtlMinutes: ttl })
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid update-status RPC response')
        const envelope = raw as { ok?: unknown; value?: unknown; error?: { message?: unknown } }
        if (envelope.ok !== true) throw new Error(typeof envelope.error?.message === 'string' ? envelope.error.message : 'update-status RPC failed')
        const status = updateStatusOf(envelope.value)
        if (status === undefined) throw new Error('invalid update-status payload')
        this.publish({ status, loading: false, error: null })
        return true
      } catch (error) {
        this.publish({ ...this.snapshot, loading: false, error: errorMessage(error) })
        return false
      }
    })()
    this.inFlight = run
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = undefined
    })
    return run
  }
}

export interface PreferencesSnapshot {
  sidebarEnabled: boolean
  cacheTtlMinutes: number
  writable: boolean
  status: 'loading' | 'ready' | 'unavailable'
}

const INITIAL_PREFERENCES: PreferencesSnapshot = {
  sidebarEnabled: true,
  cacheTtlMinutes: DEFAULT_CACHE_TTL_MINUTES,
  writable: false,
  status: 'loading',
}

export class PreferencesStore implements Observable<PreferencesSnapshot> {
  private snapshot: PreferencesSnapshot = INITIAL_PREFERENCES
  private readonly listeners = new Set<() => void>()
  private scope: SettingsScopeLike | undefined

  getSnapshot = (): PreferencesSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  attach(scope: SettingsScopeLike): () => void {
    this.scope = scope
    const sync = () => {
      const raw = scope.getSnapshot()
      const value = raw.value !== null && typeof raw.value === 'object' && !Array.isArray(raw.value)
        ? raw.value as Record<string, unknown>
        : {}
      const status = raw.status === 'ready' || raw.status === 'unavailable' ? raw.status : 'loading'
      this.publish({
        sidebarEnabled: value.sidebarEnabled !== false,
        cacheTtlMinutes: isCacheTtlMinutes(value.cacheTtlMinutes) ? value.cacheTtlMinutes : DEFAULT_CACHE_TTL_MINUTES,
        writable: raw.writable === true,
        status,
      })
    }
    sync()
    return scope.subscribe(sync)
  }

  setSidebarEnabled(enabled: boolean): void {
    const previous = this.snapshot
    this.publish({ ...previous, sidebarEnabled: enabled })
    const scope = this.scope
    if (scope === undefined || !previous.writable) return
    void scope.set('sidebarEnabled', enabled).catch(() => {
      // A rejected Host-backed write restores the authoritative scope snapshot.
      try {
        const raw = scope.getSnapshot()
        const value = raw.value !== null && typeof raw.value === 'object' && !Array.isArray(raw.value)
          ? raw.value as Record<string, unknown>
          : {}
        this.publish({
          sidebarEnabled: value.sidebarEnabled !== false,
          cacheTtlMinutes: isCacheTtlMinutes(value.cacheTtlMinutes) ? value.cacheTtlMinutes : DEFAULT_CACHE_TTL_MINUTES,
          writable: raw.writable === true,
          status: raw.status === 'ready' || raw.status === 'unavailable' ? raw.status : 'loading',
        })
      } catch {
        this.publish(previous)
      }
    })
  }

  setCacheTtlMinutes(cacheTtlMinutes: number): void {
    if (!isCacheTtlMinutes(cacheTtlMinutes)) return
    const previous = this.snapshot
    this.publish({ ...previous, cacheTtlMinutes })
    const scope = this.scope
    if (scope === undefined || !previous.writable) return
    void scope.set('cacheTtlMinutes', cacheTtlMinutes).catch(() => { this.publish(previous) })
  }

  private publish(next: PreferencesSnapshot): void {
    const previous = this.snapshot
    if (previous.sidebarEnabled === next.sidebarEnabled
      && previous.cacheTtlMinutes === next.cacheTtlMinutes
      && previous.writable === next.writable && previous.status === next.status) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export interface PanelSnapshot {
  open: boolean
}

/** Open state of the detail panel, whose only trigger is the brand-row chip. */
export class PanelStore implements Observable<PanelSnapshot> {
  private snapshot: PanelSnapshot = { open: false }
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): PanelSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  toggle(): void {
    this.set({ open: !this.snapshot.open })
  }

  close(): void { this.set({ open: false }) }

  private set(next: PanelSnapshot): void {
    if (this.snapshot.open === next.open) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

/**
 * The one settings namespace, which on DSH 0.1.7 IS the Loader entry id in
 * `cordis.patch.yml`: the Host half's volatile `Config` fields are projected as
 * that entry's form, and the browser half addresses the same id through
 * `ctx.configForms.get(...)`.
 */
export const SETTINGS_NAMESPACE = PLUGIN_ID
