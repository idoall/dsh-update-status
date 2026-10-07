import { describe, expect, it } from 'vitest'
import { RestartController, collectActiveWork, restartStatusOf } from '../../src/host/restart.ts'

const launchdEnv = { DSH_WEB_SUPERVISOR: 'dsh-update-status', XPC_SERVICE_NAME: 'com.idoall.dsh-update-status.web' }

function ctx(services: Record<string, unknown>) {
  return { get: (name: string) => services[name] }
}

function idleServices() {
  return {
    agents: { list: () => [] },
    jobs: { list: () => [] },
    terminals: { list: () => [] },
  }
}

describe('safe restart controller', () => {
  it('requires both its marker and the platform supervisor identity', () => {
    expect(restartStatusOf({ platform: 'darwin', env: {}, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'not-supervised' })
    expect(restartStatusOf({ platform: 'darwin', env: { DSH_WEB_SUPERVISOR: 'dsh-update-status' }, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'supervisor-mismatch' })
    expect(restartStatusOf({ platform: 'darwin', env: launchdEnv, instanceId: 'one' })).toEqual({ instanceId: 'one', available: true, supervisor: 'launchd', unavailableReason: null })
    expect(restartStatusOf({ platform: 'darwin', env: launchdEnv, versions: { electron: '44.0.0' }, instanceId: 'one' })).toMatchObject({ available: false, unavailableReason: 'desktop' })
  })

  it('fails closed when an activity registry is unavailable', () => {
    expect(collectActiveWork(ctx({ agents: { list: () => [] } }))).toEqual({ available: false, hasActive: false, items: [] })
  })

  it('lists active agent, job, and terminal work', () => {
    const agent = { id: 'a1', status: 'running' }
    const activity = collectActiveWork(ctx({
      agents: { list: () => [agent] },
      jobs: { list: () => [{ id: 'job-1', label: 'Build', status: 'running', owner: 'a1' }] },
      terminals: { list: () => [{ sessionId: 'term-1', name: 'Shell', status: { kind: 'running' } }] },
    }))
    expect(activity.available).toBe(true)
    expect(activity.items.map(item => item.type)).toEqual(['agent', 'job', 'terminal'])
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
    const running = { ...idleServices(), agents: { list: () => [{ id: 'a1', status: 'running' }] } }
    expect(controller.request(ctx(running), false, 'live')).toMatchObject({ kind: 'active-work' })
  })
})
