/**
 * dsh-update-status — client settings-scope faces (structural).
 *
 * The runtime scope object comes from `ctx.settingsScope.bind({ namespace })`
 * (dsh-client-ui-settings). The plugin never imports that package at runtime, so
 * the consumed members are re-typed here against the published SettingsScope
 * contract and re-proved at the boundary.
 *
 * `set(field, value)` is the member this plugin actually calls; the official
 * scope implements it as `mutate([{ op: 'set', path: [field], value }])`, so the
 * direct Host channel (hostDirectScope.ts) mirrors that exact semantic.
 */

/** Mirrors dsh-client-ui-settings' SettingsScopeSnapshot<T>. */
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

/** The bound settings scope (ctx.settingsScope.bind result), reduced to what is used here. */
export interface SettingsScopeLike {
  getSnapshot(): SettingsScopeSnapshotLike
  subscribe(listener: () => void): () => void
  /** Queue one scalar field write inside the namespace section. */
  set(field: string, value: unknown): Promise<void>
}

/** The ctx.settingsScope binder face. */
export interface SettingsScopeBinderFace {
  bind(spec: { namespace: string }): SettingsScopeLike
}

/** Guard: does an object look like a binder with bind()? */
export function binderOf(raw: unknown): SettingsScopeBinderFace | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const candidate = raw as { settingsScope?: unknown }
  const binder = candidate.settingsScope
  if (binder === null || typeof binder !== 'object') return undefined
  if (typeof (binder as { bind?: unknown }).bind !== 'function') return undefined
  return binder as SettingsScopeBinderFace
}

/** Guard: does an object look like a bound scope? */
export function scopeOf(value: unknown): SettingsScopeLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const scope = value as { getSnapshot?: unknown; subscribe?: unknown; set?: unknown }
  if (typeof scope.getSnapshot !== 'function') return undefined
  if (typeof scope.subscribe !== 'function') return undefined
  if (typeof scope.set !== 'function') return undefined
  return scope as unknown as SettingsScopeLike
}
