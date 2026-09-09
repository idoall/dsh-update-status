/** Small observable stores shared by the independent sidebar and overlay slots. */

import { isReleaseChannel, PLUGIN_ID, RELEASE_CHANNELS, UPDATE_ENDPOINTS, UPDATE_STATUS_CHANNEL, type ReleaseChannel, type UpdateStatus } from '../shared/types.ts'
import type { ConnectionClient, Observable, SettingsScope } from './contract.ts'
import { errorMessage, updateStatusOf } from './contract.ts'

export interface StatusSnapshot {
  status: UpdateStatus | null
  loading: boolean
  error: string | null
}

const INITIAL_STATUS: StatusSnapshot = { status: null, loading: true, error: null }

export class StatusStore implements Observable<StatusSnapshot> {
  private snapshot: StatusSnapshot
  private readonly allowRequests: boolean
  private readonly listeners = new Set<() => void>()
  private inFlight: Promise<boolean> | undefined
  private stopped = false

  constructor(private readonly connection: ConnectionClient, staticVersion: string | null = null) {
    this.allowRequests = staticVersion === null
    this.snapshot = staticVersion === null
      ? INITIAL_STATUS
      : { status: {
        currentVersion: staticVersion,
        latestVersion: null,
        hasUpdate: false,
        cached: true,
        checkedAt: null,
        warning: null,
        installKind: 'unknown',
        upgradeCommand: '',
        releaseUrl: '',
        changelogUrl: '',
        publishedAt: null,
        packageName: '@deepseek-ai/dsh',
        channel: 'latest',
        channels: RELEASE_CHANNELS.map(channel => ({ channel, version: null, publishedAt: null, compatibility: 'unverified' })),
        canApplyInPlace: false,
      }, loading: false, error: null }
  }

  getSnapshot = (): StatusSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** First mount reads the Host's cached status; it never starts a browser timer. */
  async load(): Promise<void> {
    if (this.allowRequests) await this.request(false)
  }

  /** User gesture only: force the Host to bypass TTL (while retaining single-flight). */
  async refresh(channel: ReleaseChannel = this.snapshot.status?.channel ?? 'latest'): Promise<void> {
    if (this.allowRequests) await this.request(true, channel)
  }

  /** Channel selection re-projects the Host cache; it is not a forced refresh. */
  async selectChannel(channel: ReleaseChannel): Promise<void> {
    if (!this.allowRequests) return
    // A persisted preference or a newer selection can arrive while another
    // channel is in flight. Keep checking after every joined request until the
    // requested projection is actually the published snapshot.
    for (let attempts = 0; attempts < 3 && !this.stopped && this.snapshot.status?.channel !== channel; attempts += 1) {
      const pending = this.inFlight
      if (pending !== undefined && !await pending) return
      if (this.stopped || this.snapshot.status?.channel === channel) return
      if (!await this.request(false, channel)) return
    }
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

  private request(force: boolean, channel: ReleaseChannel = this.snapshot.status?.channel ?? 'latest'): Promise<boolean> {
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
        const raw = await rpc.call(UPDATE_STATUS_CHANNEL, endpoint, force ? { force: true, channel } : { channel })
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
  channel: ReleaseChannel
  writable: boolean
  status: 'loading' | 'ready' | 'unavailable'
}

const INITIAL_PREFERENCES: PreferencesSnapshot = { sidebarEnabled: true, channel: 'latest', writable: false, status: 'loading' }

export class PreferencesStore implements Observable<PreferencesSnapshot> {
  private snapshot: PreferencesSnapshot = INITIAL_PREFERENCES
  private readonly listeners = new Set<() => void>()
  private scope: SettingsScope | undefined

  getSnapshot = (): PreferencesSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  attach(scope: SettingsScope): () => void {
    this.scope = scope
    const sync = () => {
      const raw = scope.getSnapshot()
      const value = raw.value !== null && typeof raw.value === 'object' && !Array.isArray(raw.value)
        ? raw.value as Record<string, unknown>
        : {}
      const status = raw.status === 'ready' || raw.status === 'unavailable' ? raw.status : 'loading'
      this.publish({
        sidebarEnabled: value.sidebarEnabled !== false,
        channel: isReleaseChannel(value.channel) ? value.channel : 'latest',
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
          channel: isReleaseChannel(value.channel) ? value.channel : 'latest',
          writable: raw.writable === true,
          status: raw.status === 'ready' || raw.status === 'unavailable' ? raw.status : 'loading',
        })
      } catch {
        this.publish(previous)
      }
    })
  }

  setChannel(channel: ReleaseChannel): void {
    const previous = this.snapshot
    this.publish({ ...previous, channel })
    const scope = this.scope
    if (scope === undefined || !previous.writable) return
    void scope.set('channel', channel).catch(() => { this.publish(previous) })
  }

  private publish(next: PreferencesSnapshot): void {
    const previous = this.snapshot
    if (previous.sidebarEnabled === next.sidebarEnabled && previous.channel === next.channel
      && previous.writable === next.writable && previous.status === next.status) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export type PanelOrigin = 'brand' | 'rail'

export interface PanelSnapshot {
  open: boolean
  origin: PanelOrigin
}

/** Open state also retains its trigger, so the desktop card sits beside it. */
export class PanelStore implements Observable<PanelSnapshot> {
  private snapshot: PanelSnapshot = { open: false, origin: 'brand' }
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): PanelSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  toggle(origin: PanelOrigin): void {
    const open = !(this.snapshot.open && this.snapshot.origin === origin)
    this.set({ open, origin })
  }

  close(): void { this.set({ ...this.snapshot, open: false }) }

  private set(next: PanelSnapshot): void {
    if (this.snapshot.open === next.open && this.snapshot.origin === next.origin) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

/** The one namespace name used by Host registration and browser binding. */
export const SETTINGS_NAMESPACE = PLUGIN_ID
