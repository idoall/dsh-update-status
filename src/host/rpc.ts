/** Authenticated static-plugin RPC on Connection's shared `/api` Fetch channel. */

import type { Context } from '@deepseek-ai/cordis'
import { isCacheTtlMinutes, isReleaseChannel, UPDATE_ENDPOINTS, UPDATE_STATUS_CHANNEL } from '../shared/types.ts'
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

type ConnectionFetchMethod = 'GET' | 'HEAD' | 'POST'

interface ConnectionFetchRoute {
  path: string
  methods: readonly ConnectionFetchMethod[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

interface ConnectionHostFace {
  fetch?: {
    register?: (route: ConnectionFetchRoute) => () => void | Promise<void>
  }
}

type ConnectionOwnerContext = Context & { connection: ConnectionHostFace }

function failure(code: string, message: string): RpcFailure {
  return { ok: false, error: { code, message, details: {} } }
}

function requestOf(value: unknown): CheckUpdateRequest | undefined {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.force !== undefined && typeof record.force !== 'boolean') return undefined
  if (record.channel !== undefined && !isReleaseChannel(record.channel)) return undefined
  if (record.cacheTtlMinutes !== undefined && !isCacheTtlMinutes(record.cacheTtlMinutes)) return undefined
  return {
    ...(record.force === undefined ? {} : { force: record.force }),
    ...(record.channel === undefined ? {} : { channel: record.channel }),
    ...(record.cacheTtlMinutes === undefined ? {} : { cacheTtlMinutes: record.cacheTtlMinutes }),
  }
}

function jsonResponse(rpcId: string, result: RpcResult): Response {
  return Response.json({
    type: 'server-response',
    rpcId,
    result,
  })
}

/** Envelope-compatible Fetch adapter for one namespaced `/api` endpoint. */
export async function dispatchUpdateStatusFetch(
  endpoint: string,
  handler: ConnectionRpcHandler,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('not found', { status: 404 })
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return new Response('content type must be application/json', { status: 415 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('body is not JSON', { status: 400 })
  }
  const record = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const rpcId = typeof record.rpcId === 'string' ? record.rpcId : 'invalid-request'
  if (record.type !== 'client-request' || record.method !== endpoint) {
    return jsonResponse(rpcId, failure('gateway/bad-request', 'invalid client-request message'))
  }
  try {
    return jsonResponse(rpcId, await handler(endpoint, record.payload, request.signal))
  } catch (error) {
    return new Response(`handler failure: ${String(error)}`, { status: 500 })
  }
}

/** Endpoint dispatcher, exported to allow exact JSON-shape tests without a Host. */
export function createUpdateStatusRpcHandler(service: UpdateStatusService): ConnectionRpcHandler {
  return async (endpoint, payload) => {
    try {
      if (endpoint === UPDATE_ENDPOINTS.getStatus) {
        const request = requestOf(payload)
        if (request === undefined) return failure('dsh-update-status/bad-request', '`force` must be boolean, `channel` must be latest, next, or alpha, and `cacheTtlMinutes` must be an integer from 30 to 1440')
        return { ok: true, value: await service.getStatus(request.channel, request.cacheTtlMinutes) }
      }
      if (endpoint === UPDATE_ENDPOINTS.checkUpdate) {
        const request = requestOf(payload)
        if (request === undefined) return failure('dsh-update-status/bad-request', '`force` must be boolean, `channel` must be latest, next, or alpha, and `cacheTtlMinutes` must be an integer from 30 to 1440')
        return { ok: true, value: await service.check(request.force === true, request.channel, request.cacheTtlMinutes) }
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
 * DSH 0.1.5 serves browser unary RPC only on the shared `/api` channel; a
 * private prefix such as `/dsh-update-status` is answered by the SPA fallback
 * with HTTP 405. Exact Fetch routes on `/api/<endpoint>` are dispatched by
 * Connection before the Typert interceptor and do not need a new HTTP prefix.
 */
export function installUpdateStatusRpc(ctx: Context, service: UpdateStatusService): void {
  const handler = createUpdateStatusRpcHandler(service)
  ctx.inject(['connection'], (owned) => {
    const connection = (owned as ConnectionOwnerContext).connection
    const register = typeof connection.fetch?.register === 'function'
      ? connection.fetch.register.bind(connection.fetch)
      : undefined
    if (register === undefined) return
    try {
      for (const endpoint of Object.values(UPDATE_ENDPOINTS)) {
        register({
          path: `${UPDATE_STATUS_CHANNEL}/${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: (request) => dispatchUpdateStatusFetch(endpoint, handler, request),
        })
      }
    } catch (error) {
      console.error('[dsh-update-status] authenticated RPC route registration failed:', error)
    }
  })
}
