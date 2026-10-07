import { describe, expect, it } from 'vitest'
import { pathsFor, planFor } from '../../src/service/plan.ts'
import type { ServiceSpec } from '../../src/service/types.ts'

function spec(platform: ServiceSpec['platform']): ServiceSpec {
  return {
    schemaVersion: 1, platform, label: 'com.idoall.dsh-update-status.web',
    nodePath: '/opt/node/bin/node', dshPath: '/opt/dsh/lib/bin.js', profile: 'web',
    workspace: '/Users/me/Work Space', host: '127.0.0.1', port: 3080,
    home: '/Users/me', dshHome: '/Users/me/.dsh', logDir: '/Users/me/.dsh/logs',
    supervisorMarker: 'dsh-update-status',
  }
}

describe('user-service plan rendering', () => {
  it('renders an explicit launchd agent with no ambient secrets', () => {
    const plan = planFor(spec('darwin'), 501)
    expect(plan.paths.definitionFile).toBe('/Users/me/Library/LaunchAgents/com.idoall.dsh-update-status.web.plist')
    expect(plan.definition).toContain('<string>/opt/node/bin/node</string>')
    expect(plan.definition).toContain('<string>/opt/dsh/lib/bin.js</string>')
    expect(plan.definition).toContain('<string>--no-open</string>')
    expect(plan.definition).toContain('<key>DSH_WEB_SUPERVISOR</key>')
    expect(plan.definition).toContain('<key>KeepAlive</key>')
    expect(plan.startCommand).toEqual(['launchctl', 'kickstart', '-k', 'gui/501/com.idoall.dsh-update-status.web'])
    expect(plan.definition).not.toContain('NPM_TOKEN')
    expect(plan.definition).not.toContain('OPENAI_API_KEY')
  })

  it('renders a user systemd unit with exit-failure restart policy', () => {
    const plan = planFor(spec('linux'))
    expect(plan.paths.definitionFile).toBe('/Users/me/.config/systemd/user/dsh-update-status-web.service')
    expect(plan.definition).toContain('Restart=on-failure')
    expect(plan.definition).toContain('RestartSec=3')
    expect(plan.definition).toContain('WorkingDirectory="/Users/me/Work Space"')
    expect(plan.definition).toContain('DSH_WEB_SUPERVISOR=dsh-update-status')
    expect(plan.startCommand).toEqual(['systemctl', '--user', 'enable', '--now', 'dsh-update-status-web.service'])
  })

  it('renders Windows Task Scheduler plus a Node-owned restart wrapper', () => {
    const plan = planFor(spec('win32'))
    expect(plan.paths.wrapperFile).toContain('dsh-web-supervisor.ps1')
    expect(plan.definition).toContain('LogonTrigger')
    expect(plan.definition).toContain('InteractiveToken')
    expect(plan.wrapper).toContain("$env:DSH_WEB_SUPERVISOR = 'dsh-update-status'")
    expect(plan.wrapper).toContain('--no-open')
    expect(plan.wrapper).not.toContain('NPM_TOKEN')
  })

  it('keeps every platform artifact below the current user home', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const paths = pathsFor(spec(platform))
      expect(paths.definitionFile.startsWith('/Users/me/')).toBe(true)
      expect(paths.stateFile.startsWith('/Users/me/')).toBe(true)
      expect(paths.stdoutFile.startsWith('/Users/me/')).toBe(true)
    }
  })
})
