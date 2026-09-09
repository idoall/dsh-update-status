/** dsh-update-status Host half: read-only version status plus authenticated RPC. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { detectInstallation } from './host/installation.ts'
import { installUpdateStatusRpc } from './host/rpc.ts'
import { installSettings } from './host/settings.ts'
import { createRegistryFetcher, DEFAULT_TIMEOUT_MS, UpdateStatusService } from './host/update-status.ts'

export const name = 'dsh-update-status'
/** Connection supplies the authenticated transport; settings remains optional. */
export const inject = ['connection']

export interface Config {
  cacheTtlHours?: number
  timeoutMs?: number
  autoCheckOnMount?: boolean
}

/** Deployment config only controls metadata-check timing; it never authorizes upgrades. */
export const Config: z<Config> = z.object({
  cacheTtlHours: z.number().step(1).min(1).max(24).default(6),
  timeoutMs: z.number().step(1).min(1_000).max(30_000).default(DEFAULT_TIMEOUT_MS),
  autoCheckOnMount: z.boolean().default(true),
})

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function apply(ctx: Context, config: Config = {}): void {
  // Cordis normally applies Config defaults. The defensive bounds retain a
  // safe read-only behavior if an older loader calls apply directly.
  const ttlHours = boundedNumber(config.cacheTtlHours, 6, 1, 24)
  const timeoutMs = boundedNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 30_000)
  const service = new UpdateStatusService({
    installation: detectInstallation(ctx),
    fetchLatest: createRegistryFetcher(timeoutMs),
    ttlMs: ttlHours * 60 * 60 * 1_000,
  })

  installSettings(ctx)
  installUpdateStatusRpc(ctx, service)

  // One process-mount check, shared with every later browser request through
  // the service's single-flight promise and six-hour TTL. No interval exists.
  if (config.autoCheckOnMount !== false) void service.getStatus()
}

export { UpdateStatusService } from './host/update-status.ts'
export type { UpdateStatus, InstallKind } from './shared/types.ts'
