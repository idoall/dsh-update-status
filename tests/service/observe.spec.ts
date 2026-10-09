import { describe, expect, it } from 'vitest'
import { observeServiceState, verifyActivatedService } from '../../src/service/observe.ts'
import type { CommandRunner, ServiceSpec } from '../../src/service/types.ts'

function spec(platform: ServiceSpec['platform']): ServiceSpec {
  return {
    schemaVersion: 1, platform, label: 'com.idoall.dsh-update-status.web',
    nodePath: '/opt/node/bin/node', dshPath: '/opt/dsh/lib/bin.js', profile: 'web',
    workspace: '/Users/me', host: '127.0.0.1', port: 3080,
    home: '/Users/me', dshHome: '/Users/me/.dsh', logDir: '/Users/me/.dsh/logs',
    supervisorMarker: 'dsh-update-status',
  }
}

const launchd: CommandRunner = (_file, args) => ({
  status: args[0] === 'print' ? 0 : 1,
  stdout: 'gui/501/com.idoall.dsh-update-status.web = {\n\tstate = running\n\tpid = 48167\n\truns = 3\n}\n',
  stderr: '',
})

describe('service state observation', () => {
  it('reads the tracked pid per platform and never guesses it', async () => {
    await expect(observeServiceState(spec('darwin'), launchd, 501)).resolves.toEqual({ running: true, pid: 48167 })
    await expect(observeServiceState(spec('darwin'), () => ({ status: 113, stdout: 'Could not find service', stderr: '' }), 501)).resolves.toEqual({ running: false })
    await expect(observeServiceState(spec('linux'), () => ({ status: 0, stdout: '4321\n', stderr: '' }), 0)).resolves.toEqual({ running: true, pid: 4321 })
    await expect(observeServiceState(spec('linux'), () => ({ status: 0, stdout: '0\n', stderr: '' }), 0)).resolves.toEqual({ running: false })
    await expect(observeServiceState(spec('win32'), () => ({ status: 0, stdout: 'Running\r\n', stderr: '' }), 0)).resolves.toEqual({ running: true })
    await expect(observeServiceState(spec('win32'), () => ({ status: 0, stdout: 'Ready\r\n', stderr: '' }), 0)).resolves.toEqual({ running: false })
  })
})

describe('post-activation verification', () => {
  it('settles when the service holds a tracked process', async () => {
    const verification = await verifyActivatedService(spec('darwin'), {
      run: launchd, uid: 501, attempts: 2, recentRestarts: () => 1, sleep: async () => {},
    })
    expect(verification).toEqual({ kind: 'settled' })
  })

  it('reports the crash loop it can already see in the evidence', async () => {
    let clock = 0
    const verification = await verifyActivatedService(spec('darwin'), {
      run: launchd, uid: 501, attempts: 3,
      recentRestarts: () => { clock += 1; return 18 },
      sleep: async () => {},
    })
    expect(verification).toEqual({ kind: 'crash-loop', recentRestarts: 18, windowMs: 180_000 })
    // Decisive on the first sample: no reason to keep waiting on a spinning job.
    expect(clock).toBe(1)
  })

  it('reports a service that never came up', async () => {
    const verification = await verifyActivatedService(spec('darwin'), {
      run: () => ({ status: 113, stdout: 'Could not find service', stderr: '' }),
      uid: 501, attempts: 2, recentRestarts: () => 0, sleep: async () => {},
    })
    expect(verification).toEqual({ kind: 'not-running' })
  })

})
