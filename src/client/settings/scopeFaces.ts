/**
 * dsh-update-status — the client's own settings-scope contract.
 *
 * This is the ONE shape the preferences store talks to, and the plugin owns it:
 * two implementations satisfy it, and neither is a value import from the harness
 * (the client bundle purity gate forbids those).
 *
 * 1. `configFormScope.ts` projects the official `ctx.configForms.get(entryId)`
 *    form — the DSH 0.1.7 successor of the removed `settingsScope` service —
 *    onto this shape.
 * 2. `hostDirectScope.ts` derives the same shape from the public
 *    `remote.settings` Remote, for the non-loopback pages where the official
 *    form is deliberately inert.
 *
 * `settingsChannel.ts` picks between them; the members below are what the
 * preferences store reads and writes.
 */

/** Per-namespace sync state the preferences store consumes. */
export interface SettingsScopeSnapshotLike {
  status: 'loading' | 'ready' | 'unavailable'
  /** Raw namespace section; `undefined` before the first accepted answer. */
  value: unknown
  /** Composition layer (the built-in base), when the owner declared one. */
  base: unknown
  /** Raw user layer as stored, when one exists; presence marks user overrides. */
  user: unknown
  /** Namespace revision fencing the next write. */
  revision: number | undefined
  /** Whether the Host document accepts writes; memory mode never does. */
  writable: boolean
  mode: 'host' | 'memory'
}

/** One path-addressed settings edit (the wire op shape). */
export type SettingsPathOpLike =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** The bound settings scope both channels implement. */
export interface SettingsScopeLike {
  getSnapshot(): SettingsScopeSnapshotLike
  subscribe(listener: () => void): () => void
  /** Queue one scalar field write inside the namespace section. */
  set(field: string, value: unknown): Promise<void>
}
