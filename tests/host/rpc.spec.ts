import { describe, expect, it } from 'vitest'
import { createUpdateStatusRpcHandler } from '../../src/host/rpc.ts'
import { RestartController } from '../../src/host/restart.ts'
import type { UpdateStatusService } from '../../src/host/update-status.ts'

const status = {
  currentVersion: '0.2.0-rc.2', latestVersion: '0.2.1-alpha.1', hasUpdate: true,
  compatibility: 'unverified' as const,
  cached: false, checkedAt: '2026-01-01T00:00:00.000Z', warning: null, warnings: [],
  installKind: 'npm-global' as const, upgradeCommand: 'npm install -g @deepseek-ai/dsh@0.2.1-alpha.1',
  releaseUrl: 'https://example.test/releases', changelogUrl: 'https://example.test/releases',
  publishedAt: null, packageName: '@deepseek-ai/dsh',
  canApplyInPlace: false as const,
}

describe('private update-status RPC shape', () => {
  it('serves only get-status and check-update', async () => {
    const calls: Array<{ force: boolean; cacheTtlMinutes?: number }> = []
    const fake = {
      getStatus: async (cacheTtlMinutes?: number) => { calls.push({ force: false, cacheTtlMinutes }); return status },
      check: async (force: boolean, cacheTtlMinutes?: number) => { calls.push({ force, cacheTtlMinutes }); return status },
    } as unknown as UpdateStatusService
    const handler = createUpdateStatusRpcHandler(fake)
    const signal = new AbortController().signal

    await expect(handler('dsh-update-status.get-status', { cacheTtlMinutes: 30 }, signal)).resolves.toEqual({ ok: true, value: status })
    await expect(handler('dsh-update-status.check-update', { force: true, cacheTtlMinutes: 30 }, signal)).resolves.toEqual({ ok: true, value: status })
    expect(calls).toEqual([
      { force: false, cacheTtlMinutes: 30 },
      { force: true, cacheTtlMinutes: 30 },
    ])
    await expect(handler('dsh-update-status.check-update', { force: 'yes' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'dsh-update-status/bad-request' } })
    await expect(handler('dsh-update-status.get-status', { cacheTtlMinutes: 29 }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'dsh-update-status/bad-request' } })
    await expect(handler('anything-else', {}, signal)).resolves.toMatchObject({ ok: false, error: { code: 'dsh-update-status/unknown-endpoint' } })
  })

  it('serves restart status/check/request only through its controller and validates its trigger payload', async () => {
    const fake = { getStatus: async () => status } as unknown as UpdateStatusService
    const restart = new RestartController({
      platform: 'darwin',
      env: { DSH_WEB_SUPERVISOR: 'dsh-update-status', XPC_SERVICE_NAME: 'com.idoall.dsh-update-status.web' },
      instanceId: 'host-one', schedule: () => {}, exit: () => {},
    })
    const host = { get: (name: string) => ({
      agents: { list: () => [] }, jobs: { list: () => [] }, terminals: { list: () => [] }, timer: { timeout: () => {} },
    })[name] }
    const handler = createUpdateStatusRpcHandler(fake, restart, host as never)
    const signal = new AbortController().signal
    await expect(handler('dsh-update-status.restart-status', {}, signal)).resolves.toMatchObject({ ok: true, value: { instanceId: 'host-one', available: true } })
    await expect(handler('dsh-update-status.restart-check', {}, signal)).resolves.toMatchObject({ ok: true, value: { kind: 'ready' } })
    await expect(handler('dsh-update-status.restart', { force: false }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'dsh-update-status/bad-request' } })
    await expect(handler('dsh-update-status.restart', { force: false, expectedInstanceId: 'host-one' }, signal)).resolves.toEqual({ ok: true, value: { kind: 'scheduled', instanceId: 'host-one' } })
  })

  it('ignores an unknown payload key instead of rejecting the read', async () => {
    // A page loaded from a build that still sends `channel` keeps working after
    // the upgrade: the field is simply not part of the request any more.
    const calls: Array<{ force: boolean; cacheTtlMinutes?: number }> = []
    const fake = {
      getStatus: async (cacheTtlMinutes?: number) => { calls.push({ force: false, cacheTtlMinutes }); return status },
    } as unknown as UpdateStatusService
    const handler = createUpdateStatusRpcHandler(fake)
    await expect(handler('dsh-update-status.get-status', { channel: 'alpha', cacheTtlMinutes: 60 }, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: status })
    expect(calls).toEqual([{ force: false, cacheTtlMinutes: 60 }])
  })
})
