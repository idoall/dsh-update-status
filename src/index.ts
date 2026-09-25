/** dsh-update-status Host half: read-only version status plus authenticated RPC. */

import type { Context } from '@deepseek-ai/cordis'
import { detectInstallation } from './host/installation.ts'
import { installUpdateStatusRpc } from './host/rpc.ts'
import { describeSchemaRuntime, schemaRuntime } from './host/schemastery.ts'
import { Config, installSettings, type UpdateStatusConfig } from './host/settings.ts'
import { createRegistryFetcher, DEFAULT_TIMEOUT_MS, describeWarning, UpdateStatusService } from './host/update-status.ts'

export const name = 'dsh-update-status'
/** Connection supplies the authenticated transport; settings remains optional. */
export const inject = ['connection']

/**
 * Deployment fields plus the volatile user preferences. DSH 0.1.7 identifies a
 * settings form by the Loader entry id, so this schema IS the entry's form and
 * the entry id in `cordis.patch.yml` is its storage key — see host/settings.ts.
 */
export { Config }
export type Config = UpdateStatusConfig

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function apply(ctx: Context, config: Config = {}): void {
  // Cordis normally applies Config defaults. The defensive bounds retain a
  // safe read-only behavior if an older loader calls apply directly.
  const ttlHours = boundedNumber(config.cacheTtlHours, 6, 1, 24)
  const timeoutMs = boundedNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 30_000)
  // The schema resolution already ran at module load (the Loader reads Config
  // before apply). Re-reading it here is free, and it is the one place that can
  // report a degraded resolution: the plugin keeps working, but its preference
  // fields cannot be volatile, and the panel says exactly which copy to remove.
  const schema = schemaRuntime()
  if (schema.warning !== null) {
    console.warn(`[dsh-update-status] ${describeSchemaRuntime(schema)} — ${describeWarning(schema.warning)}`)
  }
  const service = new UpdateStatusService({
    installation: detectInstallation(ctx),
    fetchLatest: createRegistryFetcher(timeoutMs),
    ttlMs: ttlHours * 60 * 60 * 1_000,
    runtimeWarnings: schema.warning === null ? [] : [schema.warning],
  })

  installSettings(ctx)
  installUpdateStatusRpc(ctx, service)

  // One process-mount check, shared with every later browser request through
  // the service's single-flight promise and six-hour TTL. No interval exists.
  if (config.autoCheckOnMount !== false) void service.getStatus()
}

export { UpdateStatusService } from './host/update-status.ts'
export type { UpdateStatus, InstallKind } from './shared/types.ts'
// Exported for the shadowed-peer guard (`tests/guards/shadowed-peer.mjs`), which
// loads the built entry with a stale schemastery planted beside it and asserts
// the platform copy still wins.
export { resolveSchemaRuntime, schemaRuntime } from './host/schemastery.ts'
export type { SchemaRuntime } from './host/schemastery.ts'
