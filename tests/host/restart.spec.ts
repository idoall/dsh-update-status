import { describe, expect, it } from 'vitest'
import { RestartController, collectActiveWork, restartStatusOf } from '../../src/host/restart.ts'

const launchdEnv = { DSH_WEB_SUPERVISOR: 'dsh-update-status', XPC_SERVICE_NAME: 'com.idoall.dsh-update-status.web' }

/** A probe that reports the platform's own verdict: this process is the job. */
const owned = async () => ({ kind: 'owned' }) as const

function ctx(services: Record<string, unknown>) {
  return { get: (name: string) => services[name] }
}

function idleServices() {
  return { agents: { list: () => [] }, jobs: { list: () => [] } }
}

/** A live agent whose OWN scope owns a terminal registry (isolate: terminals). */
function liveAgent(terminals?: unknown, status = 'running') {
  const owner = { id: 's1', status, ctx: { get: (name: string) => (name === 'terminals' ? terminals : undefined) } }
  return { owner, services: { agents: { list: () => [owner] }, jobs: { list: () => [] } } }
}

describe('safe restart controller', () => {
  it('requires the explicit marker, and reports only a claim about the supervisor', () => {
    expect(restartStatusOf({ platform: 'darwin', env: {}, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'not-supervised' })
    const claimed = restartStatusOf({ platform: 'darwin', env: launchdEnv, instanceId: 'one', startedAt: '2026-10-09T00:25:03.000Z' })
    expect(claimed).toEqual({ instanceId: 'one', startedAt: '2026-10-09T00:25:03.000Z', available: true, supervisor: 'launchd', unavailableReason: null })
    // This is a claim, not proof: the environment marker is inherited by every
    // descendant. What makes it an answer is the platform probe in `assess()`,
    // which is why the same env with no probe wired is refused below.
    expect(restartStatusOf({ platform: 'darwin', env: launchdEnv, versions: { electron: '44.0.0' }, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'desktop' })
  })

  it('does not depend on the launchd label surviving into the environment', () => {
    // Observed on a real host: launchd configures XPC_SERVICE_NAME=<label> for the
    // job, but the DSH process behind the staged /bin/sh wrapper reads
    // `XPC_SERVICE_NAME=0`. An environment check here disabled the button on the
    // very setup this plugin installs, so identity comes from the probe instead.
    const hostEnv = { DSH_WEB_SUPERVISOR: 'dsh-update-status', XPC_SERVICE_NAME: '0' }
    expect(restartStatusOf({ platform: 'darwin', env: hostEnv, instanceId: 'one' })).toMatchObject({ available: true, supervisor: 'launchd', unavailableReason: null })
  })

  it('reports this process\' start time even when a restart is refused', () => {
    // The settings panel shows it beside the version, so it must not depend on
    // supervision being available — an unsupervised Host is exactly where an
    // operator wants to know how long this instance has been up.
    const before = Date.now()
    const derived = restartStatusOf({ platform: 'darwin', env: {}, instanceId: 'one' })
    const started = Date.parse(derived.startedAt)
    expect(Number.isNaN(started)).toBe(false)
    expect(started).toBeLessThanOrEqual(before)
    // Node reports uptime with sub-second precision; allow a generous second of
    // scheduling slack rather than asserting an exact instant.
    expect(before - started).toBeLessThan(process.uptime() * 1_000 + 1_000)
    expect(derived.available).toBe(false)
    expect(derived.unavailableReason).toBe('not-supervised')
    // Stable for the lifetime of the process, so a re-render cannot make it drift.
    expect(restartStatusOf({ platform: 'darwin', env: {}, instanceId: 'one' }).startedAt).toBe(derived.startedAt)
  })

  it('fails closed when the agent registry itself cannot answer', () => {
    expect(collectActiveWork(ctx({}))).toEqual({ available: false, hasActive: false, items: [] })
    expect(collectActiveWork(ctx({ agents: { list: () => { throw new Error('poisoned') } } }))).toEqual({ available: false, hasActive: false, items: [] })
    expect(collectActiveWork({})).toEqual({ available: false, hasActive: false, items: [] })
  })

  it('treats a Host with no job registry as having no jobs, not as a failed inspection', () => {
    // This is the real macOS/Linux/Windows shape: jobs is a root service, but a
    // composition without it can own no job at all.
    expect(collectActiveWork(ctx({ agents: { list: () => [] } }))).toEqual({ available: true, hasActive: false, items: [] })
    expect(collectActiveWork(ctx({ agents: { list: () => [] }, jobs: undefined }))).toEqual({ available: true, hasActive: false, items: [] })
  })

  it('refuses when a job registry exists but throws', () => {
    expect(collectActiveWork(ctx({ agents: { list: () => [] }, jobs: { list: () => { throw new Error('poisoned') } } }))).toEqual({ available: false, hasActive: false, items: [] })
  })

  it('never requires a root-level terminal registry (it is isolate-scoped per agent)', () => {
    // Regression: a root `ctx.get('terminals')` is undefined by construction, and
    // treating that as "inspection failed" disabled the real restart button on a
    // live host. An agent scope without a terminal service simply owns no PTY.
    const noTerminals = liveAgent(undefined)
    expect(collectActiveWork(ctx(noTerminals.services))).toEqual({ available: true, hasActive: true, items: [{ type: 'agent', id: 's1', label: 's1', status: 'running' }] })
  })

  it('lists active agent, job, and per-agent terminal work', () => {
    const { owner, services } = liveAgent({ list: () => [{ sessionId: 'term-1', name: 'Shell', status: { kind: 'running' } }] })
    const activity = collectActiveWork(ctx({
      ...services,
      jobs: { list: () => [{ id: 'job-1', label: 'Build', status: 'running', owner: owner.id }] },
    }))
    expect(activity.available).toBe(true)
    expect(activity.items.map(item => item.type)).toEqual(['agent', 'job', 'terminal'])
  })

  it('ignores exited terminals, and still reports a live PTY owned by an idle agent', () => {
    const exited = liveAgent({ list: () => [{ sessionId: 'term-1', status: { kind: 'exited' } }] }, 'idle')
    expect(collectActiveWork(ctx(exited.services))).toEqual({ available: true, hasActive: false, items: [] })
    // A terminal outlives the turn that opened it, so agent status must not hide it.
    const idle = liveAgent({ list: () => [{ sessionId: 'term-1', status: { kind: 'running' } }] }, 'idle')
    expect(collectActiveWork(ctx(idle.services))).toMatchObject({
      available: true, hasActive: true,
      items: [{ type: 'terminal', id: 'term-1', status: 'running' }],
    })
  })

  it('refuses when an agent context or its terminal list cannot be read', () => {
    const noCtx = { agents: { list: () => [{ id: 's1', status: 'running' }] }, jobs: { list: () => [] } }
    expect(collectActiveWork(ctx(noCtx))).toEqual({ available: false, hasActive: false, items: [] })
    const throwing = liveAgent({ list: () => { throw new Error('poisoned') } })
    expect(collectActiveWork(ctx(throwing.services))).toEqual({ available: false, hasActive: false, items: [] })
  })

  it('rechecks activity and schedules exactly one exit after its response grace period', async () => {
    const delays: number[] = []
    const exits: number[] = []
    let scheduled: (() => void) | undefined
    const controller = new RestartController({ platform: 'darwin', env: launchdEnv, instanceId: 'old', health: owned, schedule: (callback, delay) => { delays.push(delay); scheduled = callback }, exit: code => { exits.push(code) } })
    const services = idleServices()
    await expect(controller.check(ctx(services))).resolves.toMatchObject({ kind: 'ready' })
    // The accepted result exists before the delayed exit callback is released.
    await expect(controller.request(ctx(services), false, 'old')).resolves.toEqual({ kind: 'scheduled', instanceId: 'old' })
    expect(delays).toEqual([500])
    expect(exits).toEqual([])
    scheduled?.()
    expect(exits).toEqual([42])
    await expect(controller.request(ctx(services), false, 'old')).resolves.toEqual({ kind: 'in-progress', instanceId: 'old' })
  })

  it('refuses a stale tab and a final active-work check without force', async () => {
    const controller = new RestartController({ platform: 'darwin', env: launchdEnv, instanceId: 'live', health: owned, schedule: () => {}, exit: () => {} })
    await expect(controller.request(ctx(idleServices()), false, 'old')).resolves.toMatchObject({ kind: 'unavailable' })
    const { services } = liveAgent()
    await expect(controller.request(ctx(services), false, 'live')).resolves.toMatchObject({ kind: 'active-work' })
    await expect(controller.request(ctx(services), true, 'live')).resolves.toMatchObject({ kind: 'scheduled' })
  })

  it('refuses a process the platform supervisor does not actually own', async () => {
    // The environment marker is inherited by every descendant: another plugin's
    // restart helper starts a real DSH Web that inherits it while launchd is busy
    // respawning a process that can never bind the port. Owning the marker is not
    // owning the service, and this is the process the panel must refuse.
    const foreign = new RestartController({
      platform: 'darwin', env: launchdEnv, instanceId: 'foreign', exit: () => {},
      health: async () => ({ kind: 'not-owner' }),
    })
    await expect(foreign.assess()).resolves.toMatchObject({ available: false, unavailableReason: 'supervisor-mismatch' })
    await expect(foreign.check(ctx(idleServices()))).resolves.toMatchObject({ kind: 'unavailable' })
    // The destructive moment must refuse as well, not only the status read.
    await expect(foreign.request(ctx(idleServices()), false, 'foreign')).resolves.toMatchObject({ kind: 'unavailable' })
  })

  it('surfaces a supervisor that cannot finish a start as its own reason', async () => {
    const storming = new RestartController({
      platform: 'darwin', env: launchdEnv, instanceId: 'live', exit: () => {},
      health: async () => ({ kind: 'thrashing', recentRestarts: 18, windowMs: 180_000 }),
    })
    await expect(storming.assess()).resolves.toMatchObject({ available: false, unavailableReason: 'supervisor-thrashing' })
  })

  it('fails closed when ownership cannot be verified at all', async () => {
    const broken = new RestartController({
      platform: 'darwin', env: launchdEnv, instanceId: 'live', exit: () => {},
      health: async () => { throw new Error('probe exploded') },
    })
    await expect(broken.assess()).resolves.toMatchObject({ available: false, unavailableReason: 'supervisor-mismatch' })
    const unverifiable = new RestartController({
      platform: 'darwin', env: launchdEnv, instanceId: 'live', exit: () => {},
      health: async () => ({ kind: 'unverifiable' }),
    })
    await expect(unverifiable.assess()).resolves.toMatchObject({ available: false, unavailableReason: 'supervisor-mismatch' })
  })

  it('carries the recovery steps only while a restart is refused', async () => {
    const recovery = (): { commands: string } => ({ commands: 'lsof -nP -iTCP:3080 -sTCP:LISTEN\nlaunchctl kickstart -k gui/501/x' })
    const refused = new RestartController({
      platform: 'darwin', env: launchdEnv, instanceId: 'live', exit: () => {},
      health: async () => ({ kind: 'not-owner' }), recovery,
    })
    await expect(refused.assess()).resolves.toMatchObject({
      available: false, unavailableReason: 'supervisor-mismatch', recovery: { commands: 'lsof -nP -iTCP:3080 -sTCP:LISTEN\nlaunchctl kickstart -k gui/501/x' },
    })
    // A button that works needs no consolation prize, and the payload stays lean.
    const offered = new RestartController({
      platform: 'darwin', env: launchdEnv, instanceId: 'live', exit: () => {},
      health: async () => ({ kind: 'owned' }), recovery,
    })
    await expect(offered.assess()).resolves.not.toHaveProperty('recovery')
  })

  it('keeps refusing even when the recovery reader itself fails', async () => {
    const broken = new RestartController({
      platform: 'darwin', env: launchdEnv, instanceId: 'live', exit: () => {},
      health: async () => ({ kind: 'not-owner' }),
      recovery: () => { throw new Error('receipt exploded') },
    })
    await expect(broken.assess()).resolves.toMatchObject({ available: false, unavailableReason: 'supervisor-mismatch' })
  })

  it('fails closed when no ownership probe is wired at all', async () => {
    // Every production controller wires the probe in `createRestartController`;
    // one constructed without it must not fall back to the inherited marker.
    const plain = new RestartController({ platform: 'darwin', env: launchdEnv, instanceId: 'live', exit: () => {} })
    await expect(plain.assess()).resolves.toMatchObject({ available: false, unavailableReason: 'supervisor-mismatch' })
  })
})
