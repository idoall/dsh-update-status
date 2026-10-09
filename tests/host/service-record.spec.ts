import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServiceRecovery } from '../../src/host/service-record.ts'
import type { ServiceSpec } from '../../src/service/types.ts'

const label = 'com.idoall.dsh-update-status.web'

function spec(platform: ServiceSpec['platform'], port = 3080): ServiceSpec {
  return {
    schemaVersion: 1, platform, label, nodePath: '/opt/node/bin/node', dshPath: '/opt/dsh/lib/bin.js',
    profile: 'web', workspace: '/Users/me', host: '127.0.0.1', port,
    home: '/Users/me', dshHome: '/Users/me/.dsh', logDir: '/Users/me/.dsh/logs',
    supervisorMarker: 'dsh-update-status',
  }
}

function receipt(overrides: Record<string, unknown> = {}, specOverride: unknown = spec('darwin')): string {
  return JSON.stringify({ version: 1, managedBy: 'dsh-update-status', spec: specOverride, paths: {}, ...overrides })
}

// Built with `join` so the stub matches the receipt path the Host asks for on
// every platform: a hardcoded POSIX string silently missed on Windows CI.
const RECEIPT_PATH = join('/Users/me/.dsh', 'dsh-update-status-service.json')

function recover(text: string, options: { uid?: number; now?: () => number } = {}) {
  return createServiceRecovery({
    env: { DSH_HOME: '/Users/me/.dsh' },
    uid: options.uid ?? 501,
    ...(options.now === undefined ? {} : { now: options.now }),
    readFile: (path) => (path === RECEIPT_PATH ? text : undefined),
  })
}

describe('service recovery advice', () => {
  it('turns the installer receipt into the two commands that give supervision back', () => {
    expect(recover(receipt())()).toEqual({
      commands: `lsof -nP -iTCP:3080 -sTCP:LISTEN\nlaunchctl kickstart -k gui/501/${label}`,
    })
  })

  it('follows the platform: systemd needs reset-failed, Windows uses netstat', () => {
    // The unit's own StartLimit is what stopped a Linux storm, so clearing it is
    // part of the recovery rather than a separate piece of advice.
    expect(recover(receipt({}, spec('linux')))()?.commands)
      .toBe('lsof -nP -iTCP:3080 -sTCP:LISTEN\nsystemctl --user reset-failed dsh-update-status-web.service && systemctl --user enable --now dsh-update-status-web.service')
    expect(recover(receipt({}, spec('win32')))()?.commands)
      .toBe('netstat -ano | findstr :3080\nschtasks.exe /Run /TN "DSH Update Status Web"')
  })

  it('reads the port from the receipt rather than assuming the default', () => {
    expect(recover(receipt({}, spec('darwin', 3123)))()?.commands).toContain('-iTCP:3123')
  })

  it('offers nothing for a missing, foreign, outdated or unusable receipt', () => {
    expect(recover('not json')()).toBeUndefined()
    expect(recover(receipt({ managedBy: 'someone-else' }))()).toBeUndefined()
    expect(recover(receipt({ version: 2 }))()).toBeUndefined()
    expect(recover(receipt({}, { ...spec('darwin'), platform: 'solaris' }))()).toBeUndefined()
    expect(recover(receipt({}, { ...spec('darwin'), port: 0 }))()).toBeUndefined()
    expect(recover(receipt({}, { ...spec('darwin'), supervisorMarker: 'other' }))()).toBeUndefined()
    expect(recover(receipt({}, { ...spec('darwin'), dshPath: undefined }))()).toBeUndefined()
    expect(createServiceRecovery({ env: { DSH_HOME: '/Users/me/.dsh' }, readFile: () => undefined })()).toBeUndefined()
    // And the Host must look for the receipt under DSH_HOME with native separators.
    let askedFor = ''
    createServiceRecovery({ env: { DSH_HOME: '/Users/me/.dsh' }, readFile: (path) => { askedFor = path; return undefined } })()
    expect(askedFor).toBe(RECEIPT_PATH)
  })

  it('caches the answer, so a status poll does not re-read on every request', () => {
    let reads = 0
    let now = 1_000
    const advice = createServiceRecovery({
      env: { DSH_HOME: '/Users/me/.dsh' }, uid: 501, now: () => now,
      readFile: () => { reads += 1; return receipt() },
    })
    advice(); advice()
    expect(reads).toBe(1)
    now += 31_000
    advice()
    expect(reads).toBe(2)
  })
})
