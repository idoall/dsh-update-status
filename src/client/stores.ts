/** Small observable stores shared by the independent sidebar and overlay slots. */

import { DEFAULT_CACHE_TTL_MINUTES, isCacheTtlMinutes, PLUGIN_ID, RESTART_ENDPOINTS, UPDATE_ENDPOINTS, UPDATE_STATUS_CHANNEL, type UpdateStatus } from '../shared/types.ts'
import type { ConnectionClient, Observable, RestartActivityItemValue, RestartPhase, RestartStatusValue } from './contract.ts'
import { errorMessage, restartCheckOf, restartRequestOf, restartStatusOf, updateStatusOf } from './contract.ts'
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

export interface RestartSnapshot {
  phase: RestartPhase
  status: RestartStatusValue | null
  activity: readonly RestartActivityItemValue[]
  elapsedMs: number
  error: string | null
}

export interface RestartStoreOptions {
  /** Injected by tests; defaults to browser timers. */
  readonly schedule?: (callback: () => void, delay: number) => unknown
  readonly cancel?: (handle: unknown) => void
  /** Per-RPC safety timeout used only while the Host is restarting. */
  readonly requestTimeout?: (callback: () => void, delay: number) => unknown
  readonly cancelRequestTimeout?: (handle: unknown) => void
  /** Same-origin liveness fallback when a new Host lacks this plugin route. */
  readonly liveness?: () => Promise<boolean>
  readonly reload?: () => void
}

const INITIAL_RESTART: RestartSnapshot = {
  phase: 'unknown', status: null, activity: [], elapsedMs: 0, error: null,
}

/**
 * Restart state belongs to the client entry, not a modal component, so closing
 * the update panel cannot strand a confirmed restart half-way through recovery.
 * It starts no timer until the user confirms a restart request.
 */
export class RestartStore implements Observable<RestartSnapshot> {
  private snapshot: RestartSnapshot = INITIAL_RESTART
  private readonly listeners = new Set<() => void>()
  private timer: unknown
  private generation = 0
  private stopped = false
  private readonly schedule: (callback: () => void, delay: number) => unknown
  private readonly cancelTimer: (handle: unknown) => void
  private readonly requestTimeout: (callback: () => void, delay: number) => unknown
  private readonly cancelRequestTimeout: (handle: unknown) => void
  private readonly liveness: () => Promise<boolean>
  private readonly reload: () => void
  private pendingAbort: AbortController | undefined
  private reloaded = false

  constructor(private readonly connection: ConnectionClient, options: RestartStoreOptions = {}) {
    this.schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay))
    this.cancelTimer = options.cancel ?? (handle => { window.clearTimeout(handle as number) })
    this.requestTimeout = options.requestTimeout ?? ((callback, delay) => window.setTimeout(callback, delay))
    this.cancelRequestTimeout = options.cancelRequestTimeout ?? (handle => { window.clearTimeout(handle as number) })
    this.liveness = options.liveness ?? (async () => {
      try {
        const response = await fetch(new URL('.', window.location.href), { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' })
        return response.status === 200 || response.status === 401
      } catch { return false }
    })
    this.reload = options.reload ?? (() => window.location.reload())
  }

  getSnapshot = (): RestartSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  stop(): void {
    this.stopped = true
    this.generation += 1
    if (this.timer !== undefined) this.cancelTimer(this.timer)
    this.timer = undefined
    this.pendingAbort?.abort()
    this.pendingAbort = undefined
    this.listeners.clear()
  }

  /** Read capability on a visible surface; this is not a restart and never polls. */
  async refresh(): Promise<void> {
    if (this.snapshot.phase === 'waiting') return
    const raw = await this.call(RESTART_ENDPOINTS.status, {})
    if (raw === undefined) return
    const status = restartStatusOf(raw)
    if (status === undefined) {
      this.publish({ ...this.snapshot, phase: 'error', error: 'invalid restart-status payload' })
      return
    }
    this.publish({ phase: status.available ? 'idle' : 'idle', status, activity: [], elapsedMs: 0, error: null })
  }

  /** First click checks active work and arms the second, destructive action. */
  async check(): Promise<void> {
    this.publish({ ...this.snapshot, phase: 'checking', error: null })
    const raw = await this.call(RESTART_ENDPOINTS.check, {})
    if (raw === undefined) return
    const checked = restartCheckOf(raw)
    if (checked === undefined) {
      this.publish({ ...this.snapshot, phase: 'error', error: 'invalid restart-check payload' })
      return
    }
    if (checked.kind === 'unavailable') {
      this.publish({ phase: 'idle', status: checked.status, activity: [], elapsedMs: 0, error: null })
      return
    }
    this.publish({
      phase: 'armed', status: checked.status,
      activity: checked.activity?.items ?? [], elapsedMs: 0, error: null,
    })
  }

  cancel(): void {
    if (this.snapshot.phase !== 'armed' && this.snapshot.phase !== 'error' && this.snapshot.phase !== 'timeout') return
    this.publish({ ...this.snapshot, phase: this.snapshot.status === null ? 'unknown' : 'idle', activity: [], elapsedMs: 0, error: null })
  }

  /** Second click emits the Host request; `force` is only true after the activity list was shown. */
  async request(force: boolean): Promise<void> {
    const current = this.snapshot
    if (current.phase !== 'armed' || current.status === null || !current.status.available) return
    this.publish({ ...current, phase: 'checking', error: null })
    const raw = await this.call(RESTART_ENDPOINTS.request, { force, expectedInstanceId: current.status.instanceId })
    if (raw === undefined) return
    const result = restartRequestOf(raw)
    if (result === undefined) {
      this.publish({ ...this.snapshot, phase: 'error', error: 'invalid restart payload' })
      return
    }
    if (result.kind === 'scheduled' || result.kind === 'in-progress') {
      if (result.instanceId === undefined) {
        this.publish({ ...this.snapshot, phase: 'error', error: 'restart response omitted instance identity' })
        return
      }
      this.beginRecovery(result.instanceId)
      return
    }
    if (result.kind === 'active-work' || result.kind === 'ready') {
      this.publish({
        phase: 'armed', status: result.status ?? current.status,
        activity: result.activity?.items ?? [], elapsedMs: 0, error: null,
      })
      return
    }
    this.publish({ phase: 'idle', status: result.status ?? current.status, activity: [], elapsedMs: 0, error: null })
  }

  private beginRecovery(previousInstanceId: string): void {
    const generation = ++this.generation
    const startedAt = Date.now()
    this.publish({ ...this.snapshot, phase: 'waiting', elapsedMs: 0, error: null })
    const attempt = async (delay: number): Promise<void> => {
      if (this.stopped || generation !== this.generation) return
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs >= 60_000) {
        this.publish({ ...this.snapshot, phase: 'timeout', elapsedMs, error: null })
        return
      }
      this.timer = this.schedule(() => {
        void (async () => {
          if (this.stopped || generation !== this.generation) return
          const raw = await this.call(RESTART_ENDPOINTS.status, {}, false, 4_000)
          if (this.stopped || generation !== this.generation) return
          const status = raw === undefined ? undefined : restartStatusOf(raw)
          const nextElapsed = Date.now() - startedAt
          if (status !== undefined && status.instanceId !== previousInstanceId) {
            this.publish({ phase: 'waiting', status, activity: [], elapsedMs: nextElapsed, error: null })
            if (!this.reloaded) { this.reloaded = true; this.reload() }
            return
          }
          // A healthy carrier with no plugin route means the new DSH came back
          // but this plugin did not load. Refresh so the page can show the real
          // startup failure instead of claiming DSH is still down forever.
          if (raw === undefined && await this.liveness()) {
            if (!this.reloaded) { this.reloaded = true; this.reload() }
            return
          }
          this.publish({ ...this.snapshot, phase: 'waiting', elapsedMs: nextElapsed })
          await attempt(Math.min(delay * 2, 10_000))
        })()
      }, delay)
    }
    void attempt(1_000)
  }

  private async call(endpoint: string, payload: unknown, surfaceError: boolean = true, timeoutMs?: number): Promise<unknown | undefined> {
    const rpc = this.connection.rpc
    if (rpc === undefined || typeof rpc.call !== 'function') {
      if (surfaceError) this.publish({ ...this.snapshot, phase: 'error', error: 'DSH connection RPC is unavailable' })
      return undefined
    }
    const controller = timeoutMs === undefined ? undefined : new AbortController()
    if (controller !== undefined) this.pendingAbort = controller
    let timeout: unknown
    if (controller !== undefined && timeoutMs !== undefined) timeout = this.requestTimeout(() => controller.abort(), timeoutMs)
    try {
      const raw = await rpc.call(UPDATE_STATUS_CHANNEL, endpoint, payload, controller?.signal)
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid restart RPC response')
      const envelope = raw as { ok?: unknown; value?: unknown; error?: { message?: unknown } }
      if (envelope.ok !== true) throw new Error(typeof envelope.error?.message === 'string' ? envelope.error.message : 'restart RPC failed')
      return envelope.value
    } catch (error) {
      if (surfaceError) this.publish({ ...this.snapshot, phase: 'error', error: errorMessage(error) })
      return undefined
    } finally {
      if (timeout !== undefined) this.cancelRequestTimeout(timeout)
      if (this.pendingAbort === controller) this.pendingAbort = undefined
    }
  }

  private publish(next: RestartSnapshot): void {
    if (this.stopped) return
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
