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

export const SUPERVISOR_MARKER = 'dsh-update-status'
export const SERVICE_LABEL = 'com.idoall.dsh-update-status.web'

export type RestartSupervisor = 'launchd' | 'systemd' | 'task-scheduler' | 'unknown'
export type RestartUnavailableReason = 'not-supervised' | 'desktop' | 'supervisor-mismatch' | 'activity-unavailable' | 'timer-unavailable' | 'stale-instance'
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
  readonly available: boolean
  readonly supervisor: RestartSupervisor | null
  readonly unavailableReason: RestartUnavailableReason | null
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
  readonly exit?: (code: number) => never | void
  readonly schedule?: (callback: () => void, delay: number) => void
}

const INSTANCE_KEY = Symbol.for('dsh-update-status/process-instance-id')

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
 * Strict supervisor recognition: the marker is written only by this package's
 * user-service installer. Platform-specific signals defend against a user
 * copying that environment variable into an arbitrary terminal by accident.
 */
export function restartStatusOf(options: RestartControllerOptions = {}): RestartStatus {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const versions = options.versions ?? process.versions
  const instanceId = options.instanceId ?? processInstanceId()
  if (versions.electron !== undefined && versions.electron !== '') {
    return { instanceId, available: false, supervisor: null, unavailableReason: 'desktop' }
  }
  if (env.DSH_WEB_SUPERVISOR !== SUPERVISOR_MARKER) {
    return { instanceId, available: false, supervisor: null, unavailableReason: 'not-supervised' }
  }
  if (platform === 'darwin') {
    if (env.XPC_SERVICE_NAME !== SERVICE_LABEL) {
      return { instanceId, available: false, supervisor: 'launchd', unavailableReason: 'supervisor-mismatch' }
    }
    return { instanceId, available: true, supervisor: 'launchd', unavailableReason: null }
  }
  if (platform === 'linux') {
    if (typeof env.INVOCATION_ID !== 'string' || env.INVOCATION_ID === '') {
      return { instanceId, available: false, supervisor: 'systemd', unavailableReason: 'supervisor-mismatch' }
    }
    return { instanceId, available: true, supervisor: 'systemd', unavailableReason: null }
  }
  if (platform === 'win32') return { instanceId, available: true, supervisor: 'task-scheduler', unavailableReason: null }
  return { instanceId, available: false, supervisor: 'unknown', unavailableReason: 'supervisor-mismatch' }
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
  private scheduled = false

  constructor(options: RestartControllerOptions = {}) {
    this.options = options
    this.instanceId = options.instanceId ?? processInstanceId()
  }

  status(): RestartStatus {
    return restartStatusOf({ ...this.options, instanceId: this.instanceId })
  }

  check(ctx: ContextLike): RestartCheckResult {
    const status = this.status()
    if (!status.available) return { kind: 'unavailable', status }
    const activity = collectActiveWork(ctx)
    if (!activity.available) return { kind: 'unavailable', status: { ...status, available: false, unavailableReason: 'activity-unavailable' } }
    if (activity.hasActive) return { kind: 'active-work', status, activity }
    return { kind: 'ready', status }
  }

  request(ctx: ContextLike, force: boolean, expectedInstanceId: string): RestartRequestResult {
    // A tab left open across a prior restart must never be able to terminate the
    // fresh Host generation it happens to reconnect to.
    if (expectedInstanceId !== this.instanceId) {
      return { kind: 'unavailable', status: { ...this.status(), available: false, unavailableReason: 'stale-instance' } }
    }
    // This is deliberately a second activity inspection. A job may start in
    // the gap between the client's "Confirm" button and this RPC request.
    const checked = this.check(ctx)
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

/** Creates the process-scoped controller once per DSH Host generation. */
export function createRestartController(): RestartController {
  return new RestartController()
}

export type RestartContext = Context
