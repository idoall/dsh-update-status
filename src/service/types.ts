/** Cross-platform, user-owned DSH Web supervision contracts. */

export type ServicePlatform = 'darwin' | 'linux' | 'win32'

export interface ServiceSpec {
  readonly schemaVersion: 1
  readonly platform: ServicePlatform
  readonly label: string
  /** Absolute Node executable used to launch the DSH CLI. */
  readonly nodePath: string
  /** Absolute DSH CLI executable (the file behind the `dsh` command). */
  readonly dshPath: string
  readonly profile: string
  readonly workspace: string
  readonly host: string
  readonly port: number
  readonly home: string
  readonly dshHome?: string
  readonly logDir: string
  /** Written by the user-service definition, never inferred from a TTY. */
  readonly supervisorMarker: 'dsh-update-status'
}

export interface ServicePaths {
  readonly stateFile: string
  readonly definitionFile: string
  /** macOS and Windows: the wrapper that owns the restart loop. */
  readonly wrapperFile?: string
  readonly stdoutFile: string
  readonly stderrFile: string
}

export interface ServicePlan {
  readonly spec: ServiceSpec
  readonly paths: ServicePaths
  readonly definition: string
  readonly wrapper?: string
  readonly installCommand: readonly string[]
  readonly startCommand: readonly string[]
  /**
   * One copy-only line that lets the service take over again after it stopped
   * (a tripped start limit, a given-up wrapper). Displayed only — never run by
   * the plugin.
   */
  readonly recoverCommand: string
  readonly statusCommand: readonly string[]
  readonly stopCommand: readonly string[]
  readonly uninstallCommand: readonly string[]
}

export interface CliEnvironment {
  readonly platform: NodeJS.Platform
  readonly home: string
  /** Numeric uid needed by launchctl's `gui/<uid>` domain. */
  readonly uid?: number
  readonly cwd: string
  readonly execPath: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly path?: string
}

export interface CommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
}

export type CommandRunner = (file: string, args: readonly string[]) => CommandResult
