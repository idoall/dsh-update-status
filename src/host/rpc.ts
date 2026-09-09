/** Authenticated static-plugin RPC channel for update-status DTOs. */

import type { Context } from '@deepseek-ai/cordis'
import { isReleaseChannel, UPDATE_ENDPOINTS, UPDATE_STATUS_CHANNEL } from '../shared/types.ts'
import type { CheckUpdateRequest, UpdateStatus } from '../shared/types.ts'
import type { UpdateStatusService } from './update-status.ts'

export interface RpcFailure {
  ok: false
  error: { code: string; message: string; details: object }
}

export interface RpcSuccess {
  ok: true
  value: UpdateStatus
}

export type RpcResult = RpcSuccess | RpcFailure

type ConnectionRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult>

interface ConnectionHostFace {
  rpc?: {
    handle?: (channel: string, handler: ConnectionRpcHandler) => () => void | Promise<void>
  }
}

function failure(code: string, message: string): RpcFailure {
  return { ok: false, error: { code, message, details: {} } }
}

function requestOf(value: unknown): CheckUpdateRequest | undefined {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.force !== undefined && typeof record.force !== 'boolean') return undefined
  if (record.channel !== undefined && !isReleaseChannel(record.channel)) return undefined
  return {
    ...(record.force === undefined ? {} : { force: record.force }),
    ...(record.channel === undefined ? {} : { channel: record.channel }),
  }
}

/** Endpoint dispatcher, exported to allow exact JSON-shape tests without a Host. */
export function createUpdateStatusRpcHandler(service: UpdateStatusService): ConnectionRpcHandler {
  return async (endpoint, payload) => {
    try {
      if (endpoint === UPDATE_ENDPOINTS.getStatus) {
        const request = requestOf(payload)
        if (request === undefined) return failure('dsh-update-status/bad-request', '`force` must be boolean and `channel` must be latest, next, or alpha')
        return { ok: true, value: await service.getStatus(request.channel) }
      }
      if (endpoint === UPDATE_ENDPOINTS.checkUpdate) {
        const request = requestOf(payload)
        if (request === undefined) return failure('dsh-update-status/bad-request', '`force` must be boolean and `channel` must be latest, next, or alpha')
        return { ok: true, value: await service.check(request.force === true, request.channel) }
      }
      return failure('dsh-update-status/unknown-endpoint', `unknown endpoint: ${endpoint}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return failure('dsh-update-status/internal', message.slice(0, 220))
    }
  }
}

/**
 * Static packages do not receive dynamic Cordis's `harness.handle` closure.
 * This registration uses DSH's existing authenticated Connection RPC transport
 * and is removed with the plugin fiber.
 */
export function installUpdateStatusRpc(ctx: Context, service: UpdateStatusService): void {
  const handler = createUpdateStatusRpcHandler(service)
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.get('connection') as ConnectionHostFace | undefined
    const handle = typeof connection?.rpc?.handle === 'function' ? connection.rpc.handle.bind(connection.rpc) : undefined
    if (handle === undefined) return
    connectionCtx.effect(() => {
      const unregister = handle(UPDATE_STATUS_CHANNEL, handler)
      return () => {
        // Cordis cleanup is synchronous; the Connection registry's async
        // disposer is intentionally detached and contained.
        void Promise.resolve(unregister()).catch(() => {})
      }
    }, 'dsh-update-status: authenticated RPC channel')
  })
}
