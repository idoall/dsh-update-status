/**
 * dsh-update-status — official settings-form adapter.
 *
 * DSH 0.1.7 removed the per-namespace `settingsScope` service this plugin's
 * client half was built on. Its successor is `ctx.configForms`
 * (`@deepseek-ai/dsh-client-ui-settings`): one shared `settings.describe`
 * mirror per browser plus a per-entry write queue, reached as
 * `ctx.configForms.get(entryId)` for the entry the plugin's Host half owns.
 * That form already answers the exact facts this plugin's own scope contract
 * needs — status, value, base, user, revision, writable, mode — so this module
 * only projects it onto {@link SettingsScopeLike} and leaves the existing
 * channel selection (`settingsChannel.ts`) in charge of the LAN fallback.
 *
 * Two deliberate translations:
 *
 * - A refused write (`set` answers `false`) becomes a REJECTION. The settings
 *   page must surface a conflict instead of pretending the edit landed, which
 *   is the same contract the direct Host channel already obeys
 *   (`hostDirectScope.ts`). A transport fault rejects too.
 * - `mode` is what separates the two pages: DSH pins it to `memory` on a
 *   non-loopback page, where the form is terminally `unavailable` and never
 *   writes — exactly the state that hands the preferences to the direct Host
 *   Remote so a phone still edits the one shared entry.
 *
 * The service is deliberately read structurally: the client bundle purity gate
 * forbids cross-plugin value imports, and the runtime object belongs to the
 * user's harness.
 */
import type { SettingsScopeLike, SettingsScopeSnapshotLike } from './scopeFaces.ts'
import { SettingsWriteFailure } from './hostDirectScope.ts'

/** One form snapshot as `ConfigForm.getSnapshot()` answers it. */
export interface ConfigFormSnapshotLike<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/** The subset of `ConfigForm<T>` this adapter reads. */
export interface ConfigFormLike<T = unknown> {
  getSnapshot(): ConfigFormSnapshotLike<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

/** The `ctx.configForms` binder face. */
export interface ConfigFormsFace {
  get<T>(entryId: string): ConfigFormLike<T>
}

/**
 * Guard: read the `configForms` face off an injection payload.
 *
 * The literal service key is read inside a `try`, because an injected payload
 * proxy can refuse a member read (the failure this plugin already hit on the
 * dotted `remote.settings` parent). Absence and refusal both answer
 * `undefined`, which leaves the channel on its direct Host path.
 *
 * @param raw - the payload a `ctx.inject(['configForms'], …)` callback received.
 * @returns the binder face, or undefined when this page has no settings forms.
 */
export function configFormsOf(raw: unknown): ConfigFormsFace | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  let face: unknown
  try {
    face = (raw as Record<string, unknown>)['configForms']
  } catch {
    return undefined
  }
  if (face === null || typeof face !== 'object') return undefined
  if (typeof (face as { get?: unknown }).get !== 'function') return undefined
  return face as ConfigFormsFace
}

/**
 * Project one official config form onto the plugin's settings-scope contract.
 *
 * @param form - the shared form for the plugin's own Loader entry id.
 * @returns a scope the preferences store and the channel selection can use as-is.
 */
export function configFormScope(form: ConfigFormLike): SettingsScopeLike {
  return {
    getSnapshot(): SettingsScopeSnapshotLike {
      const snapshot = form.getSnapshot()
      return {
        status: snapshot.status,
        value: snapshot.value as SettingsScopeSnapshotLike['value'],
        base: snapshot.base,
        user: snapshot.user,
        revision: snapshot.revision,
        writable: snapshot.writable,
        mode: snapshot.mode,
      }
    },
    subscribe(listener) {
      return form.subscribe(listener)
    },
    async set(field, value) {
      let accepted: boolean
      try {
        accepted = await form.set(field, value)
      } catch (error) {
        // Transport fault: the write did not land and the caller must not
        // pretend it did (the recovery read belongs to the form itself).
        throw new SettingsWriteFailure(
          'settings/unreachable',
          error instanceof Error ? error.message : String(error),
        )
      }
      if (!accepted) {
        // Refused or skipped (memory mode, stale revision, Host validation):
        // the form has already re-read the authoritative value.
        throw new SettingsWriteFailure('settings/conflict')
      }
    },
  }
}
