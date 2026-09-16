/**
 * dsh-update-status — client entry wiring specs.
 *
 * Locks the LAN regression that made DSH `0.1.6-alpha.1` + this plugin look
 * broken from a bridge-served page: the client half used to gate the whole
 * feature on `connection.isLoopback === true`, so on any non-loopback origin it
 * never issued `POST /api/dsh-update-status.get-status`, the sidebar chip fell
 * back to this bundle's declared compatible release instead of the running
 * version, and the detail panel could not open at all.
 *
 * The entry point is a plain CJS-style module (`module.exports`, the shape the
 * DSH web module loader executes), so it is imported dynamically and driven
 * through a structural fake of the Cordis client context.
 */
import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../../src/shared/types.ts'

interface RegisteredEntry {
  options: { name: string; id?: string; priority?: number; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

interface RpcCall {
  channel: string
  endpoint: string
  payload: unknown
}

interface Mounted {
  registered: RegisteredEntry[]
  effectLabels: string[]
  teardown: () => void
}

const status: UpdateStatus = {
  currentVersion: '0.1.6-alpha.1',
  latestVersion: '0.1.5-rc.1',
  hasUpdate: false,
  cached: true,
  checkedAt: '2026-09-16T13:33:37.470Z',
  warning: null,
  installKind: 'npm-global',
  upgradeCommand: 'npm install -g @deepseek-ai/dsh@latest',
  releaseUrl: 'https://example.test/releases',
  changelogUrl: 'https://example.test/releases',
  publishedAt: '2026-09-10T03:12:53.293Z',
  packageName: '@deepseek-ai/dsh',
  channel: 'latest',
  channels: [
    { channel: 'latest', version: '0.1.5-rc.1', publishedAt: null, compatibility: 'verified' },
    { channel: 'next', version: '0.1.5-rc.2', publishedAt: null, compatibility: 'unverified' },
    { channel: 'alpha', version: '0.1.6-alpha.1', publishedAt: null, compatibility: 'verified' },
  ],
  canApplyInPlace: false,
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** A Connection face that records the browser→Host reads this entry issues. */
function connectionRpc(isLoopback: boolean, calls: RpcCall[], payload: UpdateStatus = status): Record<string, unknown> {
  return {
    isLoopback,
    rpc: {
      call: async (channel: string, endpoint: string, body: unknown) => {
        calls.push({ channel, endpoint, payload: body })
        return { ok: true, value: payload }
      },
    },
  }
}

/** Mount the real client entry against a structural Cordis client context. */
async function mount(connection: Record<string, unknown>): Promise<Mounted> {
  const client = await import('../../src/client/index.ts') as unknown as {
    apply: (ctx: unknown) => void
  }
  const registered: RegisteredEntry[] = []
  const effectLabels: string[] = []
  const disposers: Array<() => void> = []

  const ctx = {
    get: (name: string): unknown => (name === 'connection' ? connection : undefined),
    slots: {
      inject: (_name: string, callback: () => unknown): (() => void) => {
        callback()
        return () => {}
      },
      register: (options: RegisteredEntry['options'], component: RegisteredEntry['component']): (() => void) => {
        registered.push({ options, component })
        return () => {}
      },
    },
    // No settings seam at all: the worst case for a bridged page. The status
    // read must not depend on the settings channel being available.
    inject: (): (() => void) => () => {},
    effect: (setup: () => (() => void) | void, label?: string): (() => void) => {
      if (label !== undefined) effectLabels.push(label)
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    on: (): (() => void) => () => {},
  }

  client.apply(ctx)
  await flush()
  return {
    registered,
    effectLabels,
    teardown: () => { for (const dispose of disposers.splice(0)) dispose() },
  }
}

describe('client entry wiring', () => {
  it('reads the Host status on a non-loopback page', async () => {
    const calls: RpcCall[] = []
    const mounted = await mount(connectionRpc(false, calls))

    expect(calls).toEqual([
      { channel: '/api', endpoint: 'dsh-update-status.get-status', payload: { channel: 'latest', cacheTtlMinutes: 360 } },
    ])
    mounted.teardown()
  })

  it('reads the Host status on a loopback page too (one code path, no gate)', async () => {
    const calls: RpcCall[] = []
    const mounted = await mount(connectionRpc(true, calls))

    expect(calls.map(call => call.endpoint)).toEqual(['dsh-update-status.get-status'])
    mounted.teardown()
  })

  it('registers the brand chip, rail fallback, overlay and settings section', async () => {
    const mounted = await mount(connectionRpc(false, []))

    expect(mounted.registered.map(entry => entry.options.name)).toEqual([
      'sidebar.brand.name',
      'sidebar.footer.action',
      'shell.overlay',
      'settings.section',
    ])
    // The chip keeps shadowing the official wordmark (lowest priority renders).
    expect(mounted.registered[0]?.options.priority).toBe(-10)
    mounted.teardown()
  })

  it('keeps its slots registered when no usable transport exists', async () => {
    const mounted = await mount({ isLoopback: false })

    expect(mounted.registered.map(entry => entry.options.name)).toContain('sidebar.brand.name')
    mounted.teardown()
  })

  it('owns exactly one lifecycle effect so teardown releases the channel', async () => {
    const mounted = await mount(connectionRpc(false, []))

    expect(mounted.effectLabels).toHaveLength(1)
    mounted.teardown()
  })
})
