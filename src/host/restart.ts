/**
 * Safe in-panel restart primitive.
 *
 * This Host half can end its own DSH process; it cannot relaunch itself. A
 * restart is therefore deliberately enabled only when the user-service
 * installer placed the explicit `DSH_WEB_SUPERVISOR=dsh-update-status` marker
 * in the process environment. The OS user service (launchd/systemd/Task
 * Scheduler wrapper) owns relaunching; this module never guesses from a TTY
 * or kills an unrelated PID.
 */

import type { Context } from '@deepseek-ai/cordis'
import { bootStampFile, serviceLogDir } from '../shared/restart-evidence.ts'

import { LAUNCHD_LABEL } from '../shared/service-platform.ts'
import { createServiceRecovery, type RestartRecovery } from './service-record.ts'
import { createSupervisorHealth, type SupervisorHealth } from './supervision.ts'

export const SUPERVISOR_MARKER = 'dsh-update-status'
export const SERVICE_LABEL = LAUNCHD_LABEL

export type RestartSupervisor = 'launchd' | 'systemd' | 'task-scheduler' | 'unknown'
export type RestartUnavailableReason = 'not-supervised' | 'desktop' | 'supervisor-mismatch' | 'supervisor-thrashing' | 'activity-unavailable' | 'timer-unavailable' | 'stale-instance'
export type RestartItemType = 'agent' | 'job' | 'terminal'

export interface RestartActivityItem {
  readonly type: RestartItemType
  readonly id: string
  readonly label: string
  readonly status: string
  readonly ownerSession?: string
}

export interface RestartActivity {
  /** All three registries were readable for this snapshot. */
  readonly available: boolean
  readonly hasActive: boolean
  readonly items: readonly RestartActivityItem[]
}

export interface RestartStatus {
  readonly instanceId: string
  /** When this DSH Web process started, ISO 8601 — the supervised service's own uptime. */
  readonly startedAt: string
  readonly available: boolean
  readonly supervisor: RestartSupervisor | null
  readonly unavailableReason: RestartUnavailableReason | null
  /**
   * Copy-only steps that give supervision back, present only while a restart is
   * refused. The panel shows them under the disabled button, because "you cannot
   * restart" is useless advice without "here is how to get the button back".
   */
  readonly recovery?: RestartRecovery
}

export type RestartCheckResult =
  | { readonly kind: 'ready'; readonly status: RestartStatus }
  | { readonly kind: 'active-work'; readonly status: RestartStatus; readonly activity: RestartActivity }
  | { readonly kind: 'unavailable'; readonly status: RestartStatus }

export type RestartRequestResult = RestartCheckResult | { readonly kind: 'scheduled'; readonly instanceId: string } | { readonly kind: 'in-progress'; readonly instanceId: string }

interface AgentLike {
  readonly id: unknown
  readonly status?: unknown
  readonly ctx?: { get?: (name: string) => unknown }
}

interface JobLike {
  readonly id: unknown
  readonly label?: unknown
  readonly status?: unknown
  readonly owner?: unknown
}

interface TerminalLike {
  readonly sessionId: unknown
  readonly name?: unknown
  readonly type?: unknown
  readonly status?: { readonly kind?: unknown }
}

interface TimerLike {
  timeout?: (callback: () => void, delay: number) => unknown
}

interface ContextLike {
  get?: (name: string) => unknown
}

export interface RestartControllerOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
  readonly versions?: Readonly<Record<string, string | undefined>>
  readonly instanceId?: string
  /** Injected by tests; defaults to this process's own start clock. */
  readonly startedAt?: string
  readonly exit?: (code: number) => never | void
  readonly schedule?: (callback: () => void, delay: number) => void
  /**
   * Platform ownership plus restart-storm evidence. Absent means the environment
   * verdict is final, which is only correct for a process that cannot be
   * re-parented — every real Host wires the probe in `createRestartController`.
   */
  readonly health?: () => Promise<SupervisorHealth>
  /** Wired in `createRestartController`; absent in tests that do not care. */
  readonly recovery?: () => RestartRecovery | undefined
}

const INSTANCE_KEY = Symbol.for('dsh-update-status/process-instance-id')
const STARTED_AT_KEY = Symbol.for('dsh-update-status/process-started-at')

/**
 * This must outlive plugin HMR/recomposition inside one Node process. A module
 * local random value would make a Host reload look like a successful restart.
 */
function processInstanceId(): string {
  const carrier = globalThis as typeof globalThis & { [INSTANCE_KEY]?: string }
  const existing = carrier[INSTANCE_KEY]
  if (existing !== undefined) return existing
  const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  carrier[INSTANCE_KEY] = created
  return created
}

/**
 * Wall-clock start of this process, derived once from `process.uptime()` — the
 * one clock the Host owns without extra bookkeeping. It is cached on globalThis
 * for the same reason as the instance id: a recomposed plugin must keep reporting
 * the start of the process it is running in, not the moment it was recomposed.
 */
function processStartedAt(): string {
  const carrier = globalThis as typeof globalThis & { [STARTED_AT_KEY]?: string }
  const existing = carrier[STARTED_AT_KEY]
  if (existing !== undefined) return existing
  const created = new Date(Date.now() - Math.round(process.uptime() * 1_000)).toISOString()
  carrier[STARTED_AT_KEY] = created
  return created
}

/**
 * The environment/platform half of the verdict: which supervisor this process
 * *claims* to be running under.
 *
 * The explicit marker is never inherited by accident, but every descendant of a
 * supervised process does inherit it, so this function alone can only report a
 * claim. What turns a claim into an answer is `assess()` below, which asks the
 * platform which process the service actually owns. The platform identity is
 * deliberately NOT read from the environment: launchd configures
 * `XPC_SERVICE_NAME=<label>` for the job, yet a DSH process behind the staged
 * `/bin/sh` wrapper reads `XPC_SERVICE_NAME=0`, so an environment check would
 * refuse the very setup this plugin installs.
 */
export function restartStatusOf(options: RestartControllerOptions = {}): RestartStatus {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const versions = options.versions ?? process.versions
  const instanceId = options.instanceId ?? processInstanceId()
  const startedAt = options.startedAt ?? processStartedAt()
  if (versions.electron !== undefined && versions.electron !== '') {
    return { instanceId, startedAt, available: false, supervisor: null, unavailableReason: 'desktop' }
  }
  if (env.DSH_WEB_SUPERVISOR !== SUPERVISOR_MARKER) {
    return { instanceId, startedAt, available: false, supervisor: null, unavailableReason: 'not-supervised' }
  }
  // `supervisor` here is the platform whose ownership probe `assess()` will run,
  // not a fact this function has established on its own.
  if (platform === 'darwin') return { instanceId, startedAt, available: true, supervisor: 'launchd', unavailableReason: null }
  if (platform === 'linux') return { instanceId, startedAt, available: true, supervisor: 'systemd', unavailableReason: null }
  if (platform === 'win32') return { instanceId, startedAt, available: true, supervisor: 'task-scheduler', unavailableReason: null }
  return { instanceId, startedAt, available: false, supervisor: 'unknown', unavailableReason: 'supervisor-mismatch' }
}

/** Same facts dsh-service lists before allowing its force-restart control. */
export function collectActiveWork(ctx: ContextLike): RestartActivity {
  const unavailable = (): RestartActivity => ({ available: false, hasActive: false, items: [] })
  const getter = typeof ctx.get === 'function' ? ctx.get.bind(ctx) : undefined
  if (getter === undefined) return unavailable()

  let agentsFace: { list?: () => AgentLike[] } | undefined
  let jobsFace: { list?: (caller?: unknown) => JobLike[] } | undefined
  try {
    agentsFace = getter('agents') as typeof agentsFace
    jobsFace = getter('jobs') as typeof jobsFace
  } catch {
    return unavailable()
  }
  // The agent registry is the primary work unit: with it unreadable nothing can
  // be enumerated by category, so that stays a refused restart. A registry this
  // Host does not provide at all is a different fact and is handled per kind
  // below, because such a kind cannot own any work in this process.
  if (typeof agentsFace?.list !== 'function') return unavailable()
  let agents: AgentLike[]
  try { agents = agentsFace.list() } catch { return unavailable() }
  const items: RestartActivityItem[] = []

  for (const agent of agents) {
    if (agent.status !== 'running') continue
    const id = String(agent.id)
    items.push({ type: 'agent', id, label: id, status: 'running' })
  }

  // A job registry owns every job, so a Host that provides none cannot have
  // any; a registry that exists but fails to answer is precisely the incomplete
  // inspection this gate refuses on.
  if (jobsFace !== undefined) {
    if (typeof jobsFace.list !== 'function') return unavailable()
    const byId = new Map<string, JobLike>()
    for (const caller of [undefined, ...agents.map(agent => agent.id)]) {
      try {
        for (const job of jobsFace.list(caller)) {
          if (job.status !== 'running' && job.status !== 'stopping') continue
          byId.set(String(job.id), job)
        }
      } catch {
        return unavailable()
      }
    }
    for (const job of byId.values()) {
      items.push({
        type: 'job',
        id: String(job.id),
        label: typeof job.label === 'string' && job.label !== '' ? job.label : String(job.id),
        status: typeof job.status === 'string' ? job.status : 'running',
        ...(job.owner === undefined ? {} : { ownerSession: String(job.owner) }),
      })
    }
  }

  // Terminals are deliberately NOT a root service: the PTY registry is composed
  // inside each agent's own tree with `isolate: terminals`, so a root-level
  // lookup is undefined by construction. The only correct path is that agent's
  // context. No registry in that scope means the scope cannot own a PTY at all;
  // an unreadable context or a throwing list is an incomplete inspection.
  const terminals = new Map<string, TerminalLike>()
  for (const owner of agents) {
    const ownerCtx = owner.ctx
    if (ownerCtx === undefined || typeof ownerCtx.get !== 'function') return unavailable()
    let face: { list?: (owner: AgentLike) => TerminalLike[] } | undefined
    try {
      face = ownerCtx.get('terminals') as typeof face
    } catch {
      return unavailable()
    }
    if (face === undefined) continue
    if (typeof face.list !== 'function') return unavailable()
    try {
      for (const terminal of face.list(owner)) {
        if (terminal.status?.kind !== 'running') continue
        terminals.set(String(terminal.sessionId), terminal)
      }
    } catch {
      return unavailable()
    }
  }
  for (const terminal of terminals.values()) {
    const id = String(terminal.sessionId)
    items.push({
      type: 'terminal', id,
      label: typeof terminal.name === 'string' && terminal.name !== ''
        ? terminal.name
        : `${typeof terminal.type === 'string' ? terminal.type : 'terminal'} terminal`,
      status: 'running',
    })
  }
  return { available: true, hasActive: items.length > 0, items }
}

export class RestartController {
  private readonly instanceId: string
  private readonly options: RestartControllerOptions
  private readonly health: (() => Promise<SupervisorHealth>) | undefined
  private readonly recovery: (() => RestartRecovery | undefined) | undefined
  private scheduled = false

  constructor(options: RestartControllerOptions = {}) {
    this.options = options
    this.instanceId = options.instanceId ?? processInstanceId()
    this.health = options.health
    this.recovery = options.recovery
  }

  status(): RestartStatus {
    return restartStatusOf({ ...this.options, instanceId: this.instanceId })
  }

  /**
   * The environment verdict plus what only the platform knows: whether this
   * process is the one its supervisor is actually tracking, and whether a restart
   * storm says the supervisor cannot complete a start at all. A probe that throws
   * is treated as unverifiable, because restart is destructive.
   */
  async assess(): Promise<RestartStatus> {
    const base = this.status()
    if (!base.available) return this.withRecovery(base)
    let health: SupervisorHealth
    if (this.health === undefined) {
      // No probe means the claim cannot be checked, and the environment marker
      // alone is inherited by every descendant: fail closed rather than trust it.
      health = { kind: 'unverifiable' }
    } else {
      try {
        health = await this.health()
      } catch {
        health = { kind: 'unverifiable' }
      }
    }
    if (health.kind === 'thrashing') return this.withRecovery({ ...base, available: false, unavailableReason: 'supervisor-thrashing' })
    if (health.kind === 'not-owner' || health.kind === 'unverifiable') {
      return this.withRecovery({ ...base, available: false, unavailableReason: 'supervisor-mismatch' })
    }
    return base
  }

  /** A refused restart carries the steps back; an offerable one does not need them. */
  private withRecovery(status: RestartStatus): RestartStatus {
    if (this.recovery === undefined) return status
    let recovery: RestartRecovery | undefined
    try {
      recovery = this.recovery()
    } catch {
      recovery = undefined
    }
    return recovery === undefined ? status : { ...status, recovery }
  }

  async check(ctx: ContextLike): Promise<RestartCheckResult> {
    const status = await this.assess()
    if (!status.available) return { kind: 'unavailable', status }
    const activity = collectActiveWork(ctx)
    if (!activity.available) return { kind: 'unavailable', status: { ...status, available: false, unavailableReason: 'activity-unavailable' } }
    if (activity.hasActive) return { kind: 'active-work', status, activity }
    return { kind: 'ready', status }
  }

  async request(ctx: ContextLike, force: boolean, expectedInstanceId: string): Promise<RestartRequestResult> {
    // A tab left open across a prior restart must never be able to terminate the
    // fresh Host generation it happens to reconnect to.
    if (expectedInstanceId !== this.instanceId) {
      return { kind: 'unavailable', status: { ...this.status(), available: false, unavailableReason: 'stale-instance' } }
    }
    // This is deliberately a second activity inspection. A job may start in
    // the gap between the client's "Confirm" button and this RPC request — and
    // ownership is re-asked here too, because that is the destructive moment.
    const checked = await this.check(ctx)
    if (checked.kind === 'unavailable') return checked
    if (checked.kind === 'active-work' && !force) return checked
    // A second tab/click can arrive inside the 500ms response grace period.
    // Do not issue another exit; it cannot make restart safer.
    if (this.scheduled) return { kind: 'in-progress', instanceId: this.instanceId }
    let timer: TimerLike | undefined
    try { timer = (ctx as ContextLike).get?.('timer') as TimerLike | undefined } catch {
      timer = undefined
    }
    const schedule = typeof timer?.timeout === 'function'
      ? (callback: () => void) => { timer.timeout!(callback, 500) }
      : this.options.schedule === undefined ? undefined : (callback: () => void) => { this.options.schedule!(callback, 500) }
    // Never fall back to a naked setTimeout: the documented guarantee is that
    // the RPC response leaves through Cordis before this Host exits.
    if (schedule === undefined) {
      return { kind: 'unavailable', status: { ...this.status(), available: false, unavailableReason: 'timer-unavailable' } }
    }
    this.scheduled = true
    const exit = this.options.exit ?? ((code: number): never => process.exit(code))
    schedule(() => { exit(42) })
    return { kind: 'scheduled', instanceId: this.instanceId }
  }
}

/**
 * Creates the process-scoped controller once per DSH Host generation.
 *
 * The health probe is wired here rather than inside the CLI's plan so the Host
 * and the installer agree on where the evidence lives: `$DSH_HOME/logs`.
 */
export function createRestartController(options: RestartControllerOptions = {}): RestartController {
  const env = options.env ?? process.env
  const health = options.health ?? createSupervisorHealth({ logDir: serviceLogDir(env), bootLog: bootStampFile(env) })
  const recovery = options.recovery ?? createServiceRecovery({ env })
  return new RestartController({ ...options, health, recovery })
}

export type RestartContext = Context

export type { RestartRecovery }
