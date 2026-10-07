import { describe, expect, it } from 'vitest'
import { RestartController, collectActiveWork, restartStatusOf } from '../../src/host/restart.ts'

const launchdEnv = { DSH_WEB_SUPERVISOR: 'dsh-update-status', XPC_SERVICE_NAME: 'com.idoall.dsh-update-status.web' }

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
  it('requires both its marker and the platform supervisor identity', () => {
    expect(restartStatusOf({ platform: 'darwin', env: {}, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'not-supervised' })
    expect(restartStatusOf({ platform: 'darwin', env: { DSH_WEB_SUPERVISOR: 'dsh-update-status' }, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'supervisor-mismatch' })
    expect(restartStatusOf({ platform: 'darwin', env: launchdEnv, instanceId: 'one' })).toEqual({ instanceId: 'one', available: true, supervisor: 'launchd', unavailableReason: null })
    expect(restartStatusOf({ platform: 'darwin', env: launchdEnv, versions: { electron: '44.0.0' }, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'desktop' })
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

  it('rechecks activity and schedules exactly one exit after its response grace period', () => {
    const delays: number[] = []
    const exits: number[] = []
    let scheduled: (() => void) | undefined
    const controller = new RestartController({ platform: 'darwin', env: launchdEnv, instanceId: 'old', schedule: (callback, delay) => { delays.push(delay); scheduled = callback }, exit: code => { exits.push(code) } })
    const services = idleServices()
    expect(controller.check(ctx(services))).toMatchObject({ kind: 'ready' })
    // The accepted result exists before the delayed exit callback is released.
    expect(controller.request(ctx(services), false, 'old')).toEqual({ kind: 'scheduled', instanceId: 'old' })
    expect(delays).toEqual([500])
    expect(exits).toEqual([])
    scheduled?.()
    expect(exits).toEqual([42])
    expect(controller.request(ctx(services), false, 'old')).toEqual({ kind: 'in-progress', instanceId: 'old' })
  })

  it('refuses a stale tab and a final active-work check without force', () => {
    const controller = new RestartController({ platform: 'darwin', env: launchdEnv, instanceId: 'live', schedule: () => {}, exit: () => {} })
    expect(controller.request(ctx(idleServices()), false, 'old')).toMatchObject({ kind: 'unavailable' })
    const { services } = liveAgent()
    expect(controller.request(ctx(services), false, 'live')).toMatchObject({ kind: 'active-work' })
    expect(controller.request(ctx(services), true, 'live')).toMatchObject({ kind: 'scheduled' })
  })
})
