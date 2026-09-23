/**
 * dsh-update-status — direct Host settings channel (non-loopback pages).
 *
 * WHY THIS EXISTS
 *
 * DSH's settings Client keeps Host persistence disabled on any page whose
 * location is not a loopback authority. `ctx.configForms.get(entryId)` — the
 * DSH 0.1.7 successor of `settingsScope.bind()` — then answers
 * `status: 'unavailable'` immediately and NEVER sends `settings.describe`
 * (`@deepseek-ai/dsh-client-ui-settings`: the persistence mode resolves from
 * `remote.$host.isLoopback` and pins a remote page to `memory`; every row it
 * backs is inert even though Connection authentication covers the API).
 *
 * The decision itself is one line in the official client:
 *
 *   const persistence = ctx.remote.$host.isLoopback ? "host" : "memory"
 *
 * and `isLoopback` is true only for `localhost` / `[::1]` / `127.0.0.0/8` pages
 * (or a transport that declares `ownsHost`). A LAN page reached through a
 * forwarding plugin is therefore non-loopback even though the API answers and
 * the page is authenticated.
 *
 * This plugin's preferences — the sidebar toggle, the followed release channel
 * and the cache policy — live in the Host settings entry `dsh-update-status`, so
 * without a channel they all silently fall back to defaults on a LAN page (the
 * host's configured `channel` would be ignored, silently switching the followed
 * release line). This module speaks the SAME public Remote the official form
 * speaks (`settings.describe` / `settings.mutate`, the generated Typert face
 * mounted by `@deepseek-ai/dsh-api-remotes`) and derives the same per-namespace
 * snapshot shape, so the ONE shared Host document keeps serving every device.
 *
 * This channel is opened ONLY when the official form reports `unavailable`
 * (see `settingsChannel.ts`), so loopback pages keep the official path and pay
 * no extra wire read. Everything here is guarded: an absent Remote, a refused
 * read, or a malformed answer leaves the preferences exactly as unavailable as
 * they were before this channel existed.
 */
import type { SettingsPathOpLike, SettingsScopeLike, SettingsScopeSnapshotLike } from './scopeFaces.ts'

/** One namespace row of a `settings.describe` answer (the fields consumed here). */
export interface SettingsNamespaceViewLike {
  readonly ns: string
  readonly value: unknown
  readonly base?: unknown
  readonly user?: unknown
  readonly revision: number
}

/** The `settings.describe` answer body. */
export interface SettingsDescribeViewLike {
  readonly writable: boolean
  readonly hasDocument?: boolean
  readonly namespaces: readonly SettingsNamespaceViewLike[]
}

/** The Remote envelope every generated client call answers with. */
export type SettingsRemoteOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error?: { readonly code?: string; readonly message?: string } }

/** The `remote.settings` namespace face (structural; never imported at runtime). */
export interface SettingsRemoteLike {
  describe(): Promise<SettingsRemoteOutcome<SettingsDescribeViewLike>>
  mutate(
    namespace: string,
    ops: readonly SettingsPathOpLike[],
    expectedRevision?: number,
  ): Promise<SettingsRemoteOutcome<SettingsNamespaceViewLike>>
}

/** A refused namespace write; `code` keeps the Host's own diagnosis. */
export class SettingsWriteFailure extends Error {
  readonly code: string

  constructor(code: string, message?: string) {
    super(message === undefined || message === '' ? code : message)
    this.name = 'SettingsWriteFailure'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Guard: does this value look like the `remote.settings` namespace face?
 * Applied to a bare service object (`ctx.get('remote.settings')` or a payload
 * member), and it never calls anything.
 */
export function settingsRemoteFace(value: unknown): SettingsRemoteLike | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.describe !== 'function' || typeof value.mutate !== 'function') return undefined
  return value as unknown as SettingsRemoteLike
}

/**
 * Guard: read the `remote.settings` face off an injection payload.
 *
 * The payload a `ctx.inject(['remote.settings'], …)` callback receives exposes
 * the LITERAL service key. Reading the dotted PARENT off that injected context
 * (`payload.remote`) throws `cannot get property "remote" without inject` — a
 * throw that used to abort a whole wiring callback on a LAN page. So the literal
 * key is read FIRST and every read is contained; the nested
 * (`payload.remote.settings`) shape is only a fallback for a plain object
 * payload. Both absence and refusal answer `undefined`.
 */
export function settingsRemoteOf(raw: unknown): SettingsRemoteLike | undefined {
  if (!isRecord(raw)) return undefined
  try {
    const direct = settingsRemoteFace((raw as Record<string, unknown>)['remote.settings'])
    if (direct !== undefined) return direct
  } catch {
    // Injected-context proxy refusal: fall through to the nested shape.
  }
  try {
    const remote = (raw as { remote?: unknown }).remote
    if (isRecord(remote)) return settingsRemoteFace(remote.settings)
  } catch {
    // Same refusal: no face is readable from this payload.
  }
  return undefined
}

/**
 * Guard: subscribe to the Host's settings-document invalidation on the Remote
 * service object (`remote.$on`). Returns undefined when the service exposes no
 * event seam — the preferences then refresh on reconnect only.
 */
export function settingsInvalidationsOf(service: unknown): ((listener: () => void) => () => void) | undefined {
  if (!isRecord(service)) return undefined
  const on = service.$on
  if (typeof on !== 'function') return undefined
  return (listener) => {
    const dispose = (on as (event: string, callback: () => void) => unknown)
      .call(service, 'settings/document-updated', listener)
    return typeof dispose === 'function' ? dispose as () => void : () => {}
  }
}

/** The channel consumers subscribe to, plus the refresh/dispose seams the client wires. */
export interface HostDirectScope extends SettingsScopeLike {
  /** Re-read the Host document; resolves after the snapshot reflects the answer. */
  load(): Promise<void>
  /** Drop every listener and stop accepting work. */
  dispose(): void
  /** Last Host error message (diagnostics only; never rendered as plugin state). */
  lastError(): string | undefined
}

function cloneOps(ops: readonly SettingsPathOpLike[]): SettingsPathOpLike[] {
  try {
    return structuredClone(ops) as SettingsPathOpLike[]
  } catch {
    // structuredClone absent/refusing the shape: copy by hand (the op payload is
    // plain JSON by contract, so a shallow structural copy is equivalent).
    return ops.map(op => (op.op === 'set'
      ? { op: 'set' as const, path: [...op.path], value: op.value }
      : { op: 'unset' as const, path: [...op.path] }))
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

function readySnapshot(
  row: SettingsNamespaceViewLike,
  writable: boolean,
): SettingsScopeSnapshotLike {
  return {
    status: 'ready',
    // The raw section crosses this boundary untouched: PreferencesStore is the
    // plugin's own strict judge and reports a hand-edited or future-schema
    // document truthfully instead of silently dropping it.
    value: row.value,
    base: row.base,
    user: row.user,
    revision: row.revision,
    writable,
    mode: 'host',
  }
}

function unavailableSnapshot(writable: boolean): SettingsScopeSnapshotLike {
  return {
    status: 'unavailable',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable,
    mode: 'host',
  }
}

/**
 * Build the direct Host settings scope for one namespace.
 *
 * Snapshot semantics mirror the official per-namespace derivation: a namespace
 * row answers `ready` with the resolved section, its `base`/`user` layers and its
 * revision fence, and the document's `writable` decides editability. A row the
 * Host does not serve answers `unavailable`; a refused read keeps the last
 * confirmed document and reports `unavailable` only while it has never held one.
 *
 * Writes are serialized in issue order, fenced by the latest known revision and
 * REJECT with {@link SettingsWriteFailure} on a Host refusal — that rejection is
 * what makes the settings page surface a conflict instead of pretending the edit
 * landed (the official scope resolves on `!ok` after its recovery read).
 *
 * @param remote - the `remote.settings` face of the page's Remote service.
 * @param namespace - the settings namespace this scope derives from.
 * @returns the scope plus its load/dispose seams.
 */
export function createHostDirectScope(remote: SettingsRemoteLike, namespace: string): HostDirectScope {
  let snapshot: SettingsScopeSnapshotLike = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
  }
  let held: SettingsScopeSnapshotLike | undefined
  let error: string | undefined
  let disposed = false
  let tail: Promise<void> = Promise.resolve()
  const listeners = new Set<() => void>()

  const publish = (next: SettingsScopeSnapshotLike): void => {
    if (disposed || sameSnapshot(next, snapshot)) return
    snapshot = next
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A broken listener must never break the channel.
      }
    }
  }

  const adopt = (next: SettingsScopeSnapshotLike): void => {
    if (next.status === 'ready') held = next
    publish(next)
  }

  async function load(): Promise<void> {
    if (disposed) return
    let outcome: SettingsRemoteOutcome<SettingsDescribeViewLike>
    try {
      outcome = await remote.describe()
    } catch (caught) {
      outcome = { ok: false, error: { message: messageOf(caught) } }
    }
    if (disposed) return
    if (!outcome.ok) {
      error = outcome.error?.message ?? outcome.error?.code ?? 'settings/describe-failed'
      // A refused read never invents state: the last confirmed document stays
      // authoritative; without one the channel is unavailable.
      publish(held ?? unavailableSnapshot(snapshot.writable))
      return
    }
    error = undefined
    const view = outcome.value
    const writable = view.writable === true
    const row = Array.isArray(view.namespaces)
      ? view.namespaces.find(candidate => candidate.ns === namespace)
      : undefined
    if (row === undefined || typeof row.revision !== 'number') {
      publish(unavailableSnapshot(writable))
      return
    }
    adopt(readySnapshot(row, writable))
  }

  /** Fold one write answer's namespace row in without a second wire read. */
  function fold(row: SettingsNamespaceViewLike, writable: boolean): void {
    if (typeof row.revision !== 'number') return
    adopt(readySnapshot(row, writable))
  }

  function mutate(ops: readonly SettingsPathOpLike[], expectedRevision?: number): Promise<void> {
    const owned = cloneOps(ops)
    const run = tail.then(async () => {
      if (disposed) throw new SettingsWriteFailure('settings/unavailable')
      const revision = expectedRevision ?? snapshot.revision
      let outcome: SettingsRemoteOutcome<SettingsNamespaceViewLike>
      try {
        outcome = revision === undefined
          ? await remote.mutate(namespace, owned)
          : await remote.mutate(namespace, owned, revision)
      } catch (caught) {
        await load()
        throw new SettingsWriteFailure('settings/unreachable', messageOf(caught))
      }
      if (outcome.ok) {
        // A successful write proves the document accepts writes on this page.
        fold(outcome.value, true)
        return
      }
      await load()
      throw new SettingsWriteFailure(
        outcome.error?.code ?? 'settings/unknown',
        outcome.error?.message,
      )
    })
    // The queue never poisons itself: the caller sees the rejection, the next
    // queued write still runs.
    tail = run.then(() => undefined, () => undefined)
    return run
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    // The official scope implements `set` exactly this way; the revision fence
    // falls back to the latest known one, same as the official pendingRevision.
    set: (field, value) => mutate([{ op: 'set', path: [field], value }]),
    load,
    dispose() {
      disposed = true
      listeners.clear()
    },
    lastError: () => error,
  }
}
