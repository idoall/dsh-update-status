/** Minimal structural client faces — runtime services stay owned by DSH. */

import type { UpdateStatus, UpdateWarning } from '../shared/types.ts'

export type RestartPhase = 'unknown' | 'idle' | 'armed' | 'checking' | 'waiting' | 'timeout' | 'error'

export interface RestartStatusValue {
  instanceId: string
  available: boolean
  supervisor: 'launchd' | 'systemd' | 'task-scheduler' | 'unknown' | null
  unavailableReason: 'not-supervised' | 'desktop' | 'supervisor-mismatch' | 'activity-unavailable' | 'timer-unavailable' | 'stale-instance' | null
}

export interface RestartActivityItemValue {
  type: 'agent' | 'job' | 'terminal'
  id: string
  label: string
  status: string
  ownerSession?: string
}

export interface RestartCheckValue {
  kind: 'ready' | 'active-work' | 'unavailable'
  status: RestartStatusValue
  activity?: { hasActive: boolean; items: RestartActivityItemValue[] }
}

export interface RestartRequestValue {
  kind: 'ready' | 'active-work' | 'unavailable' | 'scheduled' | 'in-progress'
  status?: RestartStatusValue
  activity?: { hasActive: boolean; items: RestartActivityItemValue[] }
  instanceId?: string
}


export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ConnectionRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

/**
 * The authenticated transport face. There is deliberately NO `isLoopback` gate
 * here: DSH's settings Client treats a non-loopback page as process-local, but
 * that is a settings *persistence* policy — the Connection RPC itself stays
 * authenticated and reachable over a LAN bridge, so gating this plugin's own
 * read-only status on it only made the panel inert on exactly the page it is
 * used from. See settings/settingsChannel.ts for the one place a loopback
 * distinction still matters (choosing the Host settings channel).
 */
export interface ConnectionClient {
  rpc?: ConnectionRpc
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
  /** Optional lifecycle event seam (Cordis contexts expose it; guarded here). */
  on?(name: string, listener: () => void): unknown
}

export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/\s+/g, ' ').trim().slice(0, 220) || 'unknown error'
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function restartStatusOf(value: unknown): RestartStatusValue | undefined {
  const record = objectOf(value)
  if (record === undefined || typeof record.instanceId !== 'string' || record.instanceId === '' || typeof record.available !== 'boolean') return undefined
  const supervisor = record.supervisor === null ? null
    : record.supervisor === 'launchd' || record.supervisor === 'systemd' || record.supervisor === 'task-scheduler' || record.supervisor === 'unknown'
      ? record.supervisor : undefined
  const unavailableReason = record.unavailableReason === null ? null
    : record.unavailableReason === 'not-supervised' || record.unavailableReason === 'desktop' || record.unavailableReason === 'supervisor-mismatch' || record.unavailableReason === 'activity-unavailable' || record.unavailableReason === 'timer-unavailable' || record.unavailableReason === 'stale-instance'
      ? record.unavailableReason : undefined
  if (supervisor === undefined || unavailableReason === undefined) return undefined
  if (record.available && (supervisor === null || unavailableReason !== null)) return undefined
  if (!record.available && unavailableReason === null) return undefined
  return { instanceId: record.instanceId, available: record.available, supervisor, unavailableReason }
}

function restartActivityOf(value: unknown): { hasActive: boolean; items: RestartActivityItemValue[] } | undefined {
  const record = objectOf(value)
  if (record === undefined || typeof record.hasActive !== 'boolean' || !Array.isArray(record.items)) return undefined
  const items: RestartActivityItemValue[] = []
  for (const raw of record.items) {
    const item = objectOf(raw)
    if (item === undefined || (item.type !== 'agent' && item.type !== 'job' && item.type !== 'terminal')
      || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.status !== 'string') return undefined
    if (item.ownerSession !== undefined && typeof item.ownerSession !== 'string') return undefined
    items.push({ type: item.type, id: item.id, label: item.label, status: item.status, ...(item.ownerSession === undefined ? {} : { ownerSession: item.ownerSession }) })
  }
  if (record.hasActive !== (items.length > 0)) return undefined
  return { hasActive: record.hasActive, items }
}

export function restartCheckOf(value: unknown): RestartCheckValue | undefined {
  const record = objectOf(value)
  if (record === undefined || (record.kind !== 'ready' && record.kind !== 'active-work' && record.kind !== 'unavailable')) return undefined
  const status = restartStatusOf(record.status)
  if (status === undefined) return undefined
  const activity = record.activity === undefined ? undefined : restartActivityOf(record.activity)
  if (record.activity !== undefined && activity === undefined) return undefined
  if (record.kind === 'active-work' && (activity === undefined || !activity.hasActive)) return undefined
  if (record.kind !== 'active-work' && activity !== undefined) return undefined
  return { kind: record.kind, status, ...(activity === undefined ? {} : { activity }) }
}

export function restartRequestOf(value: unknown): RestartRequestValue | undefined {
  const record = objectOf(value)
  if (record === undefined || (record.kind !== 'ready' && record.kind !== 'active-work' && record.kind !== 'unavailable' && record.kind !== 'scheduled' && record.kind !== 'in-progress')) return undefined
  if (record.kind === 'scheduled' || record.kind === 'in-progress') return typeof record.instanceId === 'string' && record.instanceId !== '' ? { kind: record.kind, instanceId: record.instanceId } : undefined
  const check = restartCheckOf(record)
  return check === undefined ? undefined : check
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function warningOf(value: unknown): UpdateWarning | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.code === 'registry-unavailable' && typeof record.detail === 'string') {
    return { code: record.code, detail: record.detail }
  }
  if (record.code === 'version-incomparable' && typeof record.currentVersion === 'string'
    && typeof record.latestVersion === 'string') {
    return {
      code: record.code,
      currentVersion: record.currentVersion,
      latestVersion: record.latestVersion,
    }
  }
  if (record.code === 'version-unverified' && typeof record.version === 'string') {
    return { code: record.code, version: record.version }
  }
  if (record.code === 'stale-schemastery') {
    const version = record.version === null ? null : stringOrNull(record.version)
    const nodeModulesDir = record.nodeModulesDir === null ? null : stringOrNull(record.nodeModulesDir)
    const path = stringOrNull(record.path)
    if (path !== null && (record.version === null || version !== null)
      && (record.nodeModulesDir === null || nodeModulesDir !== null)) {
      return { code: record.code, version, path, nodeModulesDir }
    }
  }
  return undefined
}

/** Reject malformed RPC output before it reaches a slot component. */
export function updateStatusOf(value: unknown): UpdateStatus | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.currentVersion !== 'string' || typeof record.hasUpdate !== 'boolean'
    || typeof record.cached !== 'boolean' || typeof record.installKind !== 'string'
    || typeof record.upgradeCommand !== 'string' || typeof record.releaseUrl !== 'string'
    || typeof record.changelogUrl !== 'string' || typeof record.packageName !== 'string'
    || record.canApplyInPlace !== false) return undefined
  const validKind = record.installKind === 'npm-global' || record.installKind === 'pnpm-global'
    || record.installKind === 'source-checkout' || record.installKind === 'unknown'
  if (!validKind) return undefined
  if (record.compatibility !== 'verified' && record.compatibility !== 'unverified' && record.compatibility !== 'incompatible') return undefined
  const latestVersion = record.latestVersion === null ? null : stringOrNull(record.latestVersion)
  const checkedAt = record.checkedAt === null ? null : stringOrNull(record.checkedAt)
  const warning = record.warning === null ? null : stringOrNull(record.warning)
  // Absent or unrecognised means a Host older than the field: leave it undefined and
  // let the visual state fall back to "any warning is a failure", never to "no warning".
  const warningKind = record.warningKind === 'failure' || record.warningKind === 'notice' ? record.warningKind : undefined
  const publishedAt = record.publishedAt === null ? null : stringOrNull(record.publishedAt)
  if ((record.latestVersion !== null && latestVersion === null) || (record.checkedAt !== null && checkedAt === null)
    || (record.warning !== null && warning === null) || (record.publishedAt !== null && publishedAt === null)) return undefined
  const warnings: UpdateWarning[] = []
  if (record.warnings !== undefined) {
    if (!Array.isArray(record.warnings)) return undefined
    for (const raw of record.warnings) {
      const parsed = warningOf(raw)
      if (parsed === undefined) return undefined
      warnings.push(parsed)
    }
  }
  return {
    currentVersion: record.currentVersion,
    latestVersion,
    hasUpdate: record.hasUpdate,
    compatibility: record.compatibility,
    cached: record.cached,
    checkedAt,
    warning,
    warningKind,
    warnings,
    installKind: record.installKind as UpdateStatus['installKind'],
    upgradeCommand: record.upgradeCommand,
    releaseUrl: record.releaseUrl,
    changelogUrl: record.changelogUrl,
    publishedAt,
    packageName: record.packageName,
    canApplyInPlace: false,
  }
}
