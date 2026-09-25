/**
 * dsh-update-status — Host half: the plugin entry's Config form and page policy.
 *
 * DSH 0.1.7 removed `ctx.settings.register(namespace, schema, options)`. The
 * settings service now projects the VOLATILE fields of each active Loader
 * entry's own `Config`, and a form namespace IS the entry id
 * (`docs/subsystems/settings.md`, "Identity and values"). There is no
 * registration call left to make: this plugin's `Config` IS its settings form,
 * and the entry id in `cordis.patch.yml` — `dsh-update-status` — is the storage
 * key the browser half addresses through `ctx.configForms.get(...)`.
 *
 * The schema therefore carries two deliberately different kinds of field:
 *
 * - **Deployment fields** (`cacheTtlHours`, `timeoutMs`, `autoCheckOnMount`):
 *   ordinary Config, set by the operator in the profile patch and *not*
 *   projected into the form. They are not `.volatile()` on purpose — changing
 *   them is a composition change, and a form edit must not rewrite them.
 * - **User preferences** (`sidebarEnabled`, `channel`, `cacheTtlMinutes`): all
 *   `.volatile()`, so a preference edit commits into the running references and
 *   emits one `loader/volatile-update` instead of remounting the plugin
 *   (`docs/cordis-tutorial/05-config.md`, "Volatile fields"). A remount on
 *   every toggle would restart the status read and drop the open panel.
 *
 * The preferences persist as this entry's `config` in the active profile's
 * `cordis.patch.yml`, which is DSH 0.1.7's official plugin-preference model —
 * the `~/.dsh/settings.yaml` namespace this plugin used before is gone.
 *
 * The schema is built from a *resolved* schemastery, never a bare import: the
 * copy that provides `volatile()` is DSH's, and a stale copy left next to this
 * plugin must not be able to shadow it. See `host/schemastery.ts` — including
 * why a missing `volatile()` degrades the form instead of throwing while the
 * plugin entry is being imported.
 */

import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type { ReleaseChannel } from '../shared/types.ts'
import { DEFAULT_CACHE_TTL_MINUTES } from '../shared/types.ts'
import { schemaRuntime } from './schemastery.ts'
import { DEFAULT_TIMEOUT_MS } from './update-status.ts'

/** Deployment config (ordinary) plus the volatile user preferences the form edits. */
export interface UpdateStatusConfig {
  /** Deployment: on-demand registry cache duration, in hours. */
  cacheTtlHours?: number
  /** Deployment: registry request timeout, in milliseconds. */
  timeoutMs?: number
  /** Deployment: run one metadata check when the process mounts the plugin. */
  autoCheckOnMount?: boolean
  /** Preference: show the sidebar version chip and its update panel. */
  sidebarEnabled?: boolean
  /** Preference: release channel followed for comparison and commands. */
  channel?: ReleaseChannel
  /** Preference: on-demand registry cache duration, in minutes. */
  cacheTtlMinutes?: number
}

/**
 * Build the Config schema from a resolved schemastery factory.
 *
 * `volatileAvailable` is the capability the resolver *verified*, not an
 * assumption. On a copy without `volatile()` the three preferences stay ordinary
 * fields — the plugin keeps loading and reports why through
 * `schemaRuntime().warning` instead of throwing while its own entry is imported.
 *
 * @param factory - A schemastery factory, structurally the package's default export.
 * @param volatileAvailable - Whether `factory` exposes the Loader's volatile projection.
 */
export function buildConfigSchema(
  factory: typeof z,
  volatileAvailable: boolean,
): z<UpdateStatusConfig, Record<string, unknown>> {
  const volatile = <T>(field: T): T => {
    if (!volatileAvailable) return field
    const method = (field as { volatile?: () => T }).volatile
    return typeof method === 'function' ? method.call(field) : field
  }
  return factory.object({
    cacheTtlHours: factory.number().step(1).min(1).max(24).default(6),
    timeoutMs: factory.number().step(1).min(1_000).max(30_000).default(DEFAULT_TIMEOUT_MS),
    autoCheckOnMount: factory.boolean().default(true),
    sidebarEnabled: volatile(factory.boolean().default(true)),
    channel: volatile(factory.union(['latest', 'next', 'alpha']).default('latest').loose()),
    cacheTtlMinutes: volatile(factory.number().min(30).max(1_440).default(DEFAULT_CACHE_TTL_MINUTES)),
  }) as unknown as z<UpdateStatusConfig, Record<string, unknown>>
}

const runtime = schemaRuntime()

/**
 * The plugin's Config schema; its volatile fields ARE the settings form.
 *
 * The explicit two-argument annotation is load-bearing: a `.volatile()` field's
 * output is a stable reference (`Volatile<T>`) rather than the bare value the
 * input side takes, so the inferred schema type cannot be named by the emitted
 * `.d.ts` (TS2883) without stating the input side here. The builder preserves
 * that contract even on the degraded path, where no field is volatile.
 */
export const Config: z<UpdateStatusConfig, Record<string, unknown>> = buildConfigSchema(
  runtime.z as typeof z,
  runtime.volatile,
)

/**
 * Suppress the auto-generated settings page for this entry.
 *
 * `autoGenerate` defaults to true, which would put a second, generic form beside
 * the plugin's own `settings.section` page. Registering the policy is the
 * documented move for a plugin that owns its preference UI (`ui-theme`,
 * `ui-chat`, `ui-conversation` all do exactly this), and the entry's row stays
 * in `settings.describe()` either way — the browser half still reads and writes
 * it through `ctx.configForms`.
 *
 * Guarded twice: a deployment without the settings service never runs the inject
 * callback (the plugin keeps working from its defaults), and a refused policy
 * registration is contained instead of taking the plugin down.
 *
 * @param ctx - Host plugin context owning the entry's page policy.
 */
export function installSettings(ctx: Context): void {
  try {
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  } catch (error) {
    // Do not let a missing or damaged settings service disable status checks.
    console.error('[dsh-update-status] settings page policy registration failed:', error)
  }
}
