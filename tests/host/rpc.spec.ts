import { describe, expect, it } from 'vitest'
import { createUpdateStatusRpcHandler } from '../../src/host/rpc.ts'
import type { UpdateStatusService } from '../../src/host/update-status.ts'

const status = {
  currentVersion: '0.1.2-rc.1', latestVersion: '0.1.2', hasUpdate: true,
  cached: false, checkedAt: '2026-01-01T00:00:00.000Z', warning: null,
  installKind: 'npm-global' as const, upgradeCommand: 'npm install -g @deepseek-ai/dsh@latest',
  releaseUrl: 'https://example.test/releases', changelogUrl: 'https://example.test/releases',
  publishedAt: null, packageName: '@deepseek-ai/dsh', channel: 'latest' as const,
  channels: [{ channel: 'latest' as const, version: '0.1.2', publishedAt: null, compatibility: 'unverified' as const }],
  canApplyInPlace: false as const,
}

describe('private update-status RPC shape', () => {
  it('serves only get-status and check-update', async () => {
    const calls: Array<{ force: boolean; channel?: string }> = []
    const fake = {
      getStatus: async () => status,
      check: async (force: boolean, channel?: string) => { calls.push({ force, channel }); return status },
    } as unknown as UpdateStatusService
    const handler = createUpdateStatusRpcHandler(fake)
    const signal = new AbortController().signal

    await expect(handler('get-status', {}, signal)).resolves.toEqual({ ok: true, value: status })
    await expect(handler('check-update', { force: true, channel: 'alpha' }, signal)).resolves.toEqual({ ok: true, value: status })
    expect(calls).toEqual([{ force: true, channel: 'alpha' }])
    await expect(handler('check-update', { force: 'yes' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'dsh-update-status/bad-request' } })
    await expect(handler('get-status', { channel: 'nightly' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'dsh-update-status/bad-request' } })
    await expect(handler('anything-else', {}, signal)).resolves.toMatchObject({ ok: false, error: { code: 'dsh-update-status/unknown-endpoint' } })
  })
})
