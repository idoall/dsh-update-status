/** Minimal structural client faces — runtime services stay owned by DSH. */

import type { InstallKind, ReleaseCandidate, UpdateStatus, UpdateWarning } from '../shared/types.ts'

export type RestartPhase = 'unknown' | 'idle' | 'armed' | 'checking' | 'waiting' | 'timeout' | 'error'

export interface RestartRecoveryValue {
  /** Copy-only advice from the installer's own receipt: find the port holder, then recover. */
  commands: string
}

export interface RestartStatusValue {
  instanceId: string
  /**
   * When the current Host process started. Optional on purpose: a bundle that was
   * hot-reloaded over an older Host must keep rendering without it.
   */
  startedAt?: string
  available: boolean
  supervisor: 'launchd' | 'systemd' | 'task-scheduler' | 'unknown' | null
  unavailableReason: 'not-supervised' | 'desktop' | 'supervisor-mismatch' | 'supervisor-thrashing' | 'activity-unavailable' | 'timer-unavailable' | 'stale-instance' | null
  /** Optional: an older Host sends no recovery steps and the panel simply omits them. */
  recovery?: RestartRecoveryValue
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
    : record.unavailableReason === 'not-supervised' || record.unavailableReason === 'desktop' || record.unavailableReason === 'supervisor-mismatch' || record.unavailableReason === 'supervisor-thrashing' || record.unavailableReason === 'activity-unavailable' || record.unavailableReason === 'timer-unavailable' || record.unavailableReason === 'stale-instance'
      ? record.unavailableReason : undefined
  if (supervisor === undefined || unavailableReason === undefined) return undefined
  if (record.startedAt !== undefined && (typeof record.startedAt !== 'string' || record.startedAt === '')) return undefined
  const recovery = record.recovery === undefined ? undefined : objectOf(record.recovery)
  if (record.recovery !== undefined && (recovery === undefined || typeof recovery.commands !== 'string' || recovery.commands === '')) return undefined
  if (record.available && (supervisor === null || unavailableReason !== null)) return undefined
  if (!record.available && unavailableReason === null) return undefined
  return {
    instanceId: record.instanceId,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    available: record.available, supervisor, unavailableReason,
    ...(recovery === undefined ? {} : { recovery: { commands: recovery.commands as string } }),
  }
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

function installKindOf(value: unknown): InstallKind | undefined {
  return value === 'npm-global' || value === 'pnpm-global' || value === 'source-checkout' || value === 'unknown'
    ? value
    : undefined
}

/**
 * A field the contract types as `string | null`.
 *
 * `null` is a value the Host chose to send; `undefined` means it was missing or
 * malformed, which a caller turns into a rejection.
 */
function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * One upgradable version, exactly as the Host described it.
 *
 * Every field is required by the contract, so a missing `line` or a numeric
 * `tag` rejects the whole payload instead of rendering a half-filled card: the
 * card list is the panel's whole answer, and a wrong one is worse than a read
 * error the operator can retry.
 */
function releaseCandidateOf(value: unknown): ReleaseCandidate | undefined {
  const record = objectOf(value)
  if (record === undefined) return undefined
  if (typeof record.version !== 'string' || record.version === '') return undefined
  if (typeof record.line !== 'string' || record.line === '') return undefined
  const tag = nullableString(record.tag)
  const publishedAt = nullableString(record.publishedAt)
  // An empty command is not a command: fold it into "this installation cannot
  // express one" so the panel shows guidance instead of a copy button that would
  // put an empty string on the clipboard.
  const command = record.command === '' ? null : nullableString(record.command)
  if (tag === undefined || publishedAt === undefined || command === undefined) return undefined
  return { version: record.version, tag, publishedAt, line: record.line, command }
}

/** The release line of a version: no SemVer maths needed, the Host's own rule. */
function releaseLineOf(version: string): string {
  return version.split('-', 1)[0] ?? version
}

/**
 * A 0.4.x Host answered with a single `latestVersion` plus its `upgradeCommand`.
 *
 * A client bundle that hot-reloads over that Host must keep the page alive, so
 * the one candidate those fields describe is synthesized instead of rejecting a
 * payload the Host is still entitled to send. `tag` is null because the legacy
 * shape never carried it.
 */
function legacyReleaseOf(record: Record<string, unknown>, installKind: InstallKind): ReleaseCandidate | undefined {
  if (typeof record.latestVersion !== 'string' || record.latestVersion === '') return undefined
  // The legacy shape allowed a missing publish time; `0.4.x` always sent the key.
  const publishedAt = record.publishedAt === undefined ? null : nullableString(record.publishedAt)
  if (publishedAt === undefined) return undefined
  // The legacy Host put guidance prose into `upgradeCommand` for a source
  // checkout or an unknown install. Reusing that string would render an English
  // sentence inside a copyable <code>, so those kinds take the guidance path.
  const command = installKind === 'npm-global' || installKind === 'pnpm-global'
    ? (typeof record.upgradeCommand === 'string' && record.upgradeCommand !== '' ? record.upgradeCommand : null)
    : null
  return {
    version: record.latestVersion,
    tag: null,
    publishedAt,
    line: releaseLineOf(record.latestVersion),
    command,
  }
}

/** Reject malformed RPC output before it reaches a slot component. */
export function updateStatusOf(value: unknown): UpdateStatus | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.currentVersion !== 'string' || typeof record.hasUpdate !== 'boolean'
    || typeof record.cached !== 'boolean' || typeof record.releaseUrl !== 'string'
    || typeof record.changelogUrl !== 'string' || typeof record.packageName !== 'string'
    || record.canApplyInPlace !== false) return undefined
  const installKind = installKindOf(record.installKind)
  if (installKind === undefined) return undefined
  const checkedAt = record.checkedAt === null ? null : stringOrNull(record.checkedAt)
  const warning = record.warning === null ? null : stringOrNull(record.warning)
  // Absent or unrecognised means a Host older than the field: leave it undefined and
  // let the visual state fall back to "any warning is a failure", never to "no warning".
  const warningKind = record.warningKind === 'failure' || record.warningKind === 'notice' ? record.warningKind : undefined
  if ((record.checkedAt !== null && checkedAt === null) || (record.warning !== null && warning === null)) return undefined

  const releases: ReleaseCandidate[] = []
  if (record.releases !== undefined) {
    if (!Array.isArray(record.releases)) return undefined
    for (const raw of record.releases) {
      const parsed = releaseCandidateOf(raw)
      if (parsed === undefined) return undefined
      releases.push(parsed)
    }
  }
  // Hot reload over a 0.4.x Host: the legacy pair still names the one version it
  // found. Only when the new array is absent or empty — a Host that sends both is
  // new, and its array is authoritative.
  if (releases.length === 0 && record.hasUpdate === true) {
    const legacy = legacyReleaseOf(record, installKind)
    if (legacy !== undefined) releases.push(legacy)
  }
  // The chip reads `hasUpdate`, the panel reads `releases`; letting them disagree
  // would paint "an update exists" over an empty card list.
  if (record.hasUpdate !== (releases.length > 0)) return undefined

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
    releases,
    hasUpdate: record.hasUpdate,
    cached: record.cached,
    checkedAt,
    warning,
    warningKind,
    warnings,
    installKind,
    releaseUrl: record.releaseUrl,
    changelogUrl: record.changelogUrl,
    packageName: record.packageName,
    canApplyInPlace: false,
  }
}
