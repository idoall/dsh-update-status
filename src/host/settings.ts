/** Host-served, per-user setting for hiding the sidebar update entry. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { UpdateStatusSettings } from '../shared/types.ts'
import { DEFAULT_CACHE_TTL_MINUTES, PLUGIN_ID } from '../shared/types.ts'

export const SettingsSchema: z<UpdateStatusSettings> = z.object({
  sidebarEnabled: z.boolean().default(true),
  channel: z.union(['latest', 'next', 'alpha']).default('latest').loose(),
  cacheTtlMinutes: z.number().min(30).max(1_440).default(DEFAULT_CACHE_TTL_MINUTES),
})

/** Settings are optional composition; absent providers leave the Web default on. */
export function installSettings(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      settingsCtx.settings.register(PLUGIN_ID as SettingsNamespace, SettingsSchema, {
        base: { sidebarEnabled: true, channel: 'latest', cacheTtlMinutes: DEFAULT_CACHE_TTL_MINUTES },
        applies: 'live',
      })
    } catch (error) {
      // Do not let a damaged third-party settings document disable status checks.
      console.error('[dsh-update-status] settings namespace registration failed:', error)
    }
  })
}
