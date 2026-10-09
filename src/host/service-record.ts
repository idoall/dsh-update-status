/**
 * What the *service* is, read back from our own installer receipt.
 *
 * The panel must be able to tell an operator how to get supervision back after
 * it was lost — a restart storm tripped the wrapper's ceiling, or another tool's
 * instance took the port. Those steps are platform commands, and the plugin
 * never guesses them: the installer wrote the receipt, so the receipt is where
 * the port and the matching recover command come from.
 *
 * Read-only and best effort. A missing, foreign or unreadable receipt simply
 * means "no recovery hint", never an error on a status route.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { dshHomeOf } from '../shared/restart-evidence.ts'
import { planFor } from '../service/plan.ts'
import type { ServiceSpec } from '../service/types.ts'

export const SERVICE_RECEIPT_FILE = 'dsh-update-status-service.json'

export interface RestartRecovery {
  /** Copy-only advice: find whoever holds the port, then let the service take over. */
  readonly commands: string
}

interface ReceiptLike {
  readonly version?: unknown
  readonly managedBy?: unknown
  readonly spec?: unknown
}

/** Whoever is listening on the port, without touching it — per platform. */
function portListCommand(platform: ServiceSpec['platform'], port: number): string {
  if (platform === 'win32') return `netstat -ano | findstr :${String(port)}`
  return `lsof -nP -iTCP:${String(port)} -sTCP:LISTEN`
}

function specOf(value: unknown): ServiceSpec | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const spec = value as Partial<ServiceSpec>
  if (spec.platform !== 'darwin' && spec.platform !== 'linux' && spec.platform !== 'win32') return undefined
  if (typeof spec.port !== 'number' || !Number.isInteger(spec.port) || spec.port < 1 || spec.port > 65_535) return undefined
  if (typeof spec.label !== 'string' || spec.label === '') return undefined
  for (const field of [spec.nodePath, spec.dshPath, spec.profile, spec.workspace, spec.host, spec.home, spec.logDir]) {
    if (typeof field !== 'string' || field === '') return undefined
  }
  if (spec.supervisorMarker !== 'dsh-update-status') return undefined
  return spec as ServiceSpec
}

export interface ServiceRecoveryOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly uid?: number
  readonly readFile?: (path: string) => string | undefined
  readonly now?: () => number
}

const CACHE_TTL_MS = 30_000

/**
 * Cached for a short window: the receipt changes only when the operator re-installs,
 * and this runs on every restart-status poll while a restart is unavailable.
 */
export function createServiceRecovery(options: ServiceRecoveryOptions = {}): () => RestartRecovery | undefined {
  const now = options.now ?? Date.now
  const read = options.readFile ?? ((path: string): string | undefined => {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) return undefined
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  })
  let cached: { at: number; value: RestartRecovery | undefined } | undefined
  return () => {
    const at = now()
    if (cached !== undefined && at - cached.at < CACHE_TTL_MS) return cached.value
    const value = readRecovery(options, read)
    cached = { at, value }
    return value
  }
}

function readRecovery(options: ServiceRecoveryOptions, read: (path: string) => string | undefined): RestartRecovery | undefined {
  const path = join(dshHomeOf(options.env ?? process.env), SERVICE_RECEIPT_FILE)
  const text = read(path)
  if (text === undefined) return undefined
  try {
    const receipt = JSON.parse(text) as ReceiptLike
    if (receipt.version !== 1 || receipt.managedBy !== 'dsh-update-status') return undefined
    const spec = specOf(receipt.spec)
    if (spec === undefined) return undefined
    const plan = planFor(spec, options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0))
    const commands = `${portListCommand(spec.platform, spec.port)}\n${plan.recoverCommand}`
    return { commands }
  } catch {
    // A receipt this plugin cannot turn into a plan yields no advice.
    return undefined
  }
}
