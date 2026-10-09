import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serialisePlan } from '../../src/service/cli.ts'
import {
  RAPID_FAILURE_LIMIT,
  RAPID_FAILURE_WINDOW_SECONDS,
  SYSTEMD_START_LIMIT_BURST,
  SYSTEMD_START_LIMIT_INTERVAL_SECONDS,
  pathsFor,
  planFor,
  specFromArgs,
} from '../../src/service/plan.ts'
import type { CliEnvironment, ServiceSpec } from '../../src/service/types.ts'

/**
 * Path assertions are built with `join` on purpose: `pathsFor` returns NATIVE
 * paths (a Windows Task Scheduler definition really is `C:\...`), so a hardcoded
 * POSIX string here would only pass on the developer's macOS machine and would
 * hide Windows separator bugs instead of catching them.
 */
const HOME = '/Users/me'

function spec(platform: ServiceSpec['platform']): ServiceSpec {
  const nodePath = platform === 'win32' ? 'C:\\Node\\node.exe' : '/opt/node/bin/node'
  const servicePath = platform === 'win32'
    ? 'C:\\Node;C:\\Users\\me\\工具;\\\\server\\share\\bin;C:\\Windows\\System32'
    : '/opt/node/bin:/custom/bin:/usr/bin:/bin'
  return {
    schemaVersion: 1, platform, label: 'com.idoall.dsh-update-status.web',
    nodePath, dshPath: platform === 'win32' ? 'C:\\DSH\\lib\\bin.js' : '/opt/dsh/lib/bin.js', profile: 'web',
    workspace: platform === 'win32' ? 'C:\\Users\\me\\Work Space' : '/Users/me/Work Space', host: '127.0.0.1', port: 3080,
    home: HOME, dshHome: join(HOME, '.dsh'), logDir: join(HOME, '.dsh', 'logs'),
    servicePath, servicePathSource: 'explicit',
    ...(platform === 'win32' ? { servicePathExt: '.COM;.EXE;.CMD' } : {}),
    supervisorMarker: 'dsh-update-status',
  }
}

describe('user-service plan rendering', () => {
  it('renders an explicit launchd agent with no ambient secrets', () => {
    const plan = planFor(spec('darwin'), 501)
    expect(plan.paths.definitionFile).toBe(join(HOME, 'Library', 'LaunchAgents', 'com.idoall.dsh-update-status.web.plist'))
    expect(plan.paths.wrapperFile).toBe(join(HOME, '.dsh', 'dsh-update-status', 'dsh-web-supervisor.sh'))
    expect(plan.definition).toContain('<key>DSH_WEB_SUPERVISOR</key>')
    // The generator consumes the one PATH already resolved and persisted by the
    // CLI; it must not add, drop, or guess a package-manager directory here.
    expect(plan.definition).toContain('<string>/opt/node/bin:/custom/bin:/usr/bin:/bin</string>')
    expect(planFor({ ...spec('darwin'), servicePath: '/opt/A&B/bin:/usr/bin' }).definition)
      .toContain('<string>/opt/A&amp;B/bin:/usr/bin</string>')
    expect(plan.startCommand).toEqual(['/bin/launchctl', 'kickstart', '-k', 'gui/501/com.idoall.dsh-update-status.web'])
    expect(plan.recoverCommand).toBe("'/bin/launchctl' kickstart -k gui/501/com.idoall.dsh-update-status.web")
    expect(plan.definition).not.toContain('NPM_TOKEN')
    expect(plan.definition).not.toContain('OPENAI_API_KEY')
    // The loop is the wrapper's, not launchd's: `KeepAlive` can only respawn
    // forever, while the wrapper can stop and say why.
    expect(plan.definition).not.toContain('<key>KeepAlive</key>')
    expect(plan.definition).toContain('dsh-web-supervisor.sh')
    expect(plan.wrapper).toContain('/opt/node/bin/node')
    expect(plan.wrapper).toContain('/opt/dsh/lib/bin.js')
    expect(plan.wrapper).toContain('--no-open')
    expect(plan.wrapper).toContain("trap forward TERM INT HUP")
    expect(plan.wrapper).not.toContain('NPM_TOKEN')
  })

  it('renders a user systemd unit with exit-failure restart policy', () => {
    const plan = planFor(spec('linux'))
    expect(plan.paths.definitionFile).toBe(join(HOME, '.config', 'systemd', 'user', 'dsh-update-status-web.service'))
    expect(plan.definition).toContain('Restart=on-failure')
    expect(plan.definition).toContain('RestartSec=3')
    expect(plan.definition).toContain('WorkingDirectory="/Users/me/Work Space"')
    expect(plan.definition).toContain('DSH_WEB_SUPERVISOR=dsh-update-status')
    expect(plan.definition).toContain('Environment="PATH=/opt/node/bin:/custom/bin:/usr/bin:/bin"')
    // A literal percent is doubled so systemd cannot treat a PATH segment as a specifier.
    expect(planFor({ ...spec('linux'), servicePath: '/opt/%h/bin:/usr/bin' }).definition)
      .toContain('Environment="PATH=/opt/%%h/bin:/usr/bin"')
    expect(plan.startCommand).toEqual(['/usr/bin/systemctl', '--user', 'enable', '--now', 'dsh-update-status-web.service'])
    // A tripped StartLimit is what stopped the storm, so clearing it is part of
    // getting the unit back — and the panel shows exactly this line.
    expect(plan.recoverCommand).toBe("'/usr/bin/systemctl' --user reset-failed dsh-update-status-web.service && '/usr/bin/systemctl' --user enable --now dsh-update-status-web.service")
  })

  it('renders Windows Task Scheduler plus a Node-owned restart wrapper', () => {
    const plan = planFor(spec('win32'))
    expect(plan.paths.wrapperFile).toContain('dsh-web-supervisor.ps1')
    expect(plan.definition).toContain('LogonTrigger')
    expect(plan.definition).toContain('InteractiveToken')
    expect(plan.wrapper).toContain("$env:PATH = 'C:\\Node;C:\\Users\\me\\工具;\\\\server\\share\\bin;C:\\Windows\\System32'")
    expect(plan.wrapper).toContain("$env:PATHEXT = '.COM;.EXE;.CMD'")
    expect(plan.wrapper).toContain("$env:DSH_WEB_SUPERVISOR = 'dsh-update-status'")
    expect(plan.wrapper).toContain('--no-open')
    expect(plan.wrapper).not.toContain('NPM_TOKEN')
    // The wrapper hands DSH its own absolute paths, never a bare command name.
    expect(plan.recoverCommand).toBe('"C:\\Windows\\System32\\schtasks.exe" /Run /TN "DSH Update Status Web"')
    expect(plan.wrapper).toContain("& '")
    expect(plan.wrapper).not.toMatch(/&\s+dsh\b/)
  })

  it('keeps old receipts compatible without inventing a Windows PATH', () => {
    const darwin = planFor({ ...spec('darwin'), servicePath: undefined, servicePathSource: undefined })
    expect(darwin.definition).toContain('<string>/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>')
    const windows = planFor({ ...spec('win32'), servicePath: undefined, servicePathSource: undefined, servicePathExt: undefined })
    // Historical Task Scheduler definitions inherited the user's logon PATH.
    expect(windows.wrapper).not.toContain('$env:PATH =')
    expect(windows.wrapper).not.toContain('$env:PATHEXT =')
    expect(JSON.parse(serialisePlan(windows)).servicePath).toEqual({
      source: 'inherited logon environment (legacy receipt)', value: null, warnings: [],
    })
  })

  it('keeps every platform artifact below the current user home', () => {
    const homePrefix = `${HOME}/`
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const paths = pathsFor(spec(platform))
      // Normalise so the same assertion holds with either separator.
      const normalize = (value: string): string => value.split('\\').join('/')
      expect(normalize(paths.definitionFile).startsWith(homePrefix)).toBe(true)
      expect(normalize(paths.stateFile).startsWith(homePrefix)).toBe(true)
      expect(normalize(paths.stdoutFile).startsWith(homePrefix)).toBe(true)
      // Linux runs under systemd directly; the other two stage a wrapper.
      if (platform !== 'linux') expect(normalize(paths.wrapperFile ?? '').startsWith(homePrefix)).toBe(true)
    }
  })

  it('captures the invoking PATH once, records its source, and honours both escape hatches', () => {
    const env: CliEnvironment = {
      platform: 'darwin', home: HOME, cwd: HOME, execPath: '/opt/node/bin/node', uid: 501,
      path: '/opt/pkg/env/active/bin:/Users/me/.cargo/bin:/usr/bin:/bin', env: {},
    }
    const base = ['--workspace', HOME, '--dsh', '/opt/dsh/lib/bin.js']
    const current = specFromArgs(base, env)
    expect(current.servicePathSource).toBe('current')
    expect(current.servicePath).toBe('/opt/node/bin:/opt/pkg/env/active/bin:/Users/me/.cargo/bin:/usr/bin:/bin')
    expect(current.servicePathCapturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const minimal = specFromArgs([...base, '--path-source', 'minimal'], env)
    expect(minimal.servicePath).toBe('/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
    const explicit = specFromArgs([...base, '--service-path', '/one:/two'], env)
    expect(explicit.servicePathSource).toBe('explicit')
    expect(explicit.servicePath).toBe('/opt/node/bin:/one:/two')
    expect(() => specFromArgs([...base, '--path-source', 'minimal', '--service-path', '/one'], env))
      .toThrow('requires `--path-source explicit`')
    expect(() => specFromArgs([...base, '--service-pathext', '.EXE'], env))
      .toThrow('supported only on Windows')
  })

  /**
   * CI guard: an unbounded supervisor definition turns one port conflict into an
   * endless respawn loop — 671 failed starts in 37 minutes in the incident this
   * suite was written for. Every platform must carry an explicit ceiling, and
   * dropping one has to fail here rather than in production.
   */
  it('bounds a crash loop in every generated supervisor definition', () => {
    const darwin = planFor(spec('darwin'), 501)
    expect(darwin.wrapper).toContain(`RAPID_FAILURE_LIMIT=${String(RAPID_FAILURE_LIMIT)}`)
    expect(darwin.wrapper).toContain(`RAPID_FAILURE_WINDOW=${String(RAPID_FAILURE_WINDOW_SECONDS)}`)
    expect(darwin.wrapper).toContain('giving up after')
    expect(darwin.wrapper).toContain('exit 78')
    // KeepAlive would put the loop back out of the wrapper's reach.
    expect(darwin.definition).not.toContain('<key>KeepAlive</key>')

    const linux = planFor(spec('linux'))
    expect(linux.definition).toContain(`StartLimitIntervalSec=${String(SYSTEMD_START_LIMIT_INTERVAL_SECONDS)}`)
    expect(linux.definition).toContain(`StartLimitBurst=${String(SYSTEMD_START_LIMIT_BURST)}`)
    // The operator needs the documented way out of a tripped limit.
    expect(linux.definition).toContain('systemctl --user reset-failed')

    const windows = planFor(spec('win32'))
    expect(windows.wrapper).toContain(`$rapidLimit = ${String(RAPID_FAILURE_LIMIT)}`)
    expect(windows.wrapper).toContain(`$rapidWindowSeconds = ${String(RAPID_FAILURE_WINDOW_SECONDS)}`)
    expect(windows.wrapper).toContain('giving up after')
    expect(windows.wrapper).toContain('exit 78')
    // The reason has to land in the service log; the task's console is not a log.
    expect(windows.wrapper).toContain('Add-Content')
    expect(windows.wrapper).not.toContain('Write-Error')
  })
})
