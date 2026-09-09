/** Minimal structural client faces — runtime services stay owned by DSH. */

import { isReleaseChannel, type ChannelRelease, type UpdateStatus } from '../shared/types.ts'

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ConnectionRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface ConnectionClient {
  isLoopback?: boolean
  rpc?: ConnectionRpc
}

export interface SettingsScopeSnapshot {
  status?: unknown
  value?: unknown
  writable?: unknown
}

export interface SettingsScope {
  getSnapshot(): SettingsScopeSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

export interface SettingsScopeBinder {
  bind(spec: { namespace: string }): SettingsScope
}

export interface SlotRegistration {
  name: string
  id?: string
  order?: number
  /** Single-slot arbitration: the lowest registered priority renders. */
  priority?: number
  label?: () => string
  locale?: string
  inject?: () => unknown
}

export interface Slots {
  inject(name: string, callback: () => unknown): () => void
  register(registration: SlotRegistration, component: (props: Record<string, unknown>) => unknown): () => void
}

export interface ClientContext {
  slots: Slots
  get(name: string): unknown
  inject(names: string[], callback: (ctx: unknown) => void): () => void
  effect(setup: () => (() => void) | void, label?: string): () => void
}

export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/\s+/g, ' ').trim().slice(0, 220) || 'unknown error'
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Reject malformed RPC output before it reaches a slot component. */
export function updateStatusOf(value: unknown): UpdateStatus | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.currentVersion !== 'string' || typeof record.hasUpdate !== 'boolean'
    || typeof record.cached !== 'boolean' || typeof record.installKind !== 'string'
    || typeof record.upgradeCommand !== 'string' || typeof record.releaseUrl !== 'string'
    || typeof record.changelogUrl !== 'string' || typeof record.packageName !== 'string'
    || !isReleaseChannel(record.channel) || !Array.isArray(record.channels) || record.canApplyInPlace !== false) return undefined
  const validKind = record.installKind === 'npm-global' || record.installKind === 'pnpm-global'
    || record.installKind === 'source-checkout' || record.installKind === 'unknown'
  if (!validKind) return undefined
  const latestVersion = record.latestVersion === null ? null : stringOrNull(record.latestVersion)
  const checkedAt = record.checkedAt === null ? null : stringOrNull(record.checkedAt)
  const warning = record.warning === null ? null : stringOrNull(record.warning)
  const publishedAt = record.publishedAt === null ? null : stringOrNull(record.publishedAt)
  if ((record.latestVersion !== null && latestVersion === null) || (record.checkedAt !== null && checkedAt === null)
    || (record.warning !== null && warning === null) || (record.publishedAt !== null && publishedAt === null)) return undefined
  const channels: ChannelRelease[] = []
  for (const raw of record.channels) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const item = raw as Record<string, unknown>
    const version = item.version === null ? null : stringOrNull(item.version)
    const channelPublishedAt = item.publishedAt === null ? null : stringOrNull(item.publishedAt)
    if (!isReleaseChannel(item.channel) || (item.version !== null && version === null)
      || (item.publishedAt !== null && channelPublishedAt === null)
      || (item.compatibility !== 'verified' && item.compatibility !== 'unverified' && item.compatibility !== 'incompatible')) return undefined
    channels.push({ channel: item.channel, version, publishedAt: channelPublishedAt, compatibility: item.compatibility })
  }
  return {
    currentVersion: record.currentVersion,
    latestVersion,
    hasUpdate: record.hasUpdate,
    cached: record.cached,
    checkedAt,
    warning,
    installKind: record.installKind as UpdateStatus['installKind'],
    upgradeCommand: record.upgradeCommand,
    releaseUrl: record.releaseUrl,
    changelogUrl: record.changelogUrl,
    publishedAt,
    packageName: record.packageName,
    channel: record.channel,
    channels,
    canApplyInPlace: false,
  }
}
