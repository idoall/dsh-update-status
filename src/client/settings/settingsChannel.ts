/**
 * dsh-update-status — settings source selection.
 *
 * The plugin's ONE storage contract is the Host settings namespace
 * `dsh-update-status`. Two client channels can serve it:
 *
 * 1. the official `settingsScope` service (loopback pages), and
 * 2. the direct Host channel (`hostDirectScope.ts`), which exists exactly
 *    because the official scope is deliberately inert on a non-loopback page —
 *    the LAN page a phone uses.
 *
 * This module picks between them without ever guessing:
 *
 * - The official scope wins whenever it is not `unavailable`, so a loopback page
 *   keeps the official semantics (schema decode, revision fences, document
 *   invalidation) and pays NO extra wire read.
 * - Only when the official scope reports `unavailable` (the documented
 *   non-loopback degradation) is the direct channel opened, lazily and once.
 * - With neither source the channel stays `loading`, i.e. exactly the state this
 *   plugin had before the direct channel existed.
 */
import type { SettingsScopeLike, SettingsScopeSnapshotLike } from './scopeFaces.ts'

/** Snapshot used while no channel has answered yet. */
const LOADING_SNAPSHOT: SettingsScopeSnapshotLike = Object.freeze({
  status: 'loading',
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
  mode: 'host',
}) as SettingsScopeSnapshotLike

export interface SettingsChannelOptions {
  /**
   * Build the direct Host channel. Called at most once, and only when the
   * official scope cannot serve this page. Returning `undefined` (the Remote
   * service is not composed) leaves the channel on the official/unavailable
   * path; a later {@link SettingsChannel.refresh} retries.
   */
  openDirect(): SettingsScopeLike | undefined
}

export interface SettingsChannel extends SettingsScopeLike {
  /** Point the channel at the official scope once the service answers. */
  setOfficial(scope: SettingsScopeLike | undefined): void
  /** Re-evaluate the selection (e.g. the Remote service just arrived). */
  refresh(): void
  /** Ask the active source for a fresh read (no-op for the official scope). */
  reload(): void
  dispose(): void
}

function sameSnapshot(a: SettingsScopeSnapshotLike, b: SettingsScopeSnapshotLike): boolean {
  return a.status === b.status
    && a.revision === b.revision
    && a.writable === b.writable
    && a.mode === b.mode
    && a.value === b.value
    && a.base === b.base
    && a.user === b.user
}

/** The load seam a direct channel exposes (the official scope refreshes itself). */
type LoadableScope = SettingsScopeLike & { load?: () => Promise<void> }

/** Ask a channel for its first/next read; a refusal surfaces as a snapshot, never a throw. */
function loadSource(source: SettingsScopeLike | undefined): Promise<void> {
  const loadable = source as LoadableScope | undefined
  if (loadable === undefined || typeof loadable.load !== 'function') return Promise.resolve()
  return Promise.resolve(loadable.load()).then(() => undefined, () => undefined)
}

export function createSettingsChannel(options: SettingsChannelOptions): SettingsChannel {
  let official: SettingsScopeLike | undefined
  let direct: SettingsScopeLike | undefined
  let active: SettingsScopeLike | undefined
  let snapshot: SettingsScopeSnapshotLike = LOADING_SNAPSHOT
  let disposed = false
  const disposers: Array<() => void> = []
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A broken listener must never break the channel.
      }
    }
  }

  const publish = (next: SettingsScopeSnapshotLike): void => {
    if (disposed || sameSnapshot(next, snapshot)) return
    snapshot = next
    notify()
  }

  const select = (): SettingsScopeLike | undefined => {
    // The official scope is authoritative unless it reports the documented
    // non-loopback degradation.
    if (official !== undefined && official.getSnapshot().status !== 'unavailable') return official
    if (direct === undefined) {
      try {
        direct = options.openDirect()
      } catch {
        direct = undefined
      }
      if (direct !== undefined) {
        try {
          disposers.push(direct.subscribe(() => {
            if (active === direct) publish(direct!.getSnapshot())
          }))
        } catch {
          // An unsubscribable direct channel is still readable synchronously.
        }
        // The direct channel has no owner to `ensure()` it (the official scope is
        // ensured by its own plugin), so the initial read is issued here.
        void loadSource(direct)
      }
    }
    return direct ?? official
  }

  const reselect = (): void => {
    if (disposed) return
    const next = select()
    if (next !== active) {
      active = next
      publish(next?.getSnapshot() ?? LOADING_SNAPSHOT)
      return
    }
    // Same source: forward its current snapshot (a change must have come from it).
    publish(next?.getSnapshot() ?? LOADING_SNAPSHOT)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(field, value) {
      const source = active
      if (source === undefined) {
        return Promise.reject(new Error('dsh-update-status: settings channel is unavailable'))
      }
      return source.set(field, value)
    },
    setOfficial(scope) {
      if (disposed) return
      official = scope
      if (scope !== undefined) {
        try {
          disposers.push(scope.subscribe(() => {
            reselect()
          }))
        } catch {
          // Guarded read path: selection still happens synchronously below.
        }
      }
      reselect()
    },
    refresh: reselect,
    reload() {
      if (active === undefined || active === official) return
      void loadSource(active)
    },
    dispose() {
      disposed = true
      listeners.clear()
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // Contained.
        }
      }
      const disposable = active as (SettingsScopeLike & { dispose?: () => void }) | undefined
      if (disposable !== undefined && typeof disposable.dispose === 'function') {
        try {
          disposable.dispose()
        } catch {
          // Contained.
        }
      }
    },
  }
}
