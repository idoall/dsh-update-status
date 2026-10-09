//#region src/service/types.d.ts
/** Cross-platform, user-owned DSH Web supervision contracts. */
type ServicePlatform = 'darwin' | 'linux' | 'win32';
interface ServiceSpec {
  readonly schemaVersion: 1;
  readonly platform: ServicePlatform;
  readonly label: string;
  /** Absolute Node executable used to launch the DSH CLI. */
  readonly nodePath: string;
  /** Absolute DSH CLI executable (the file behind the `dsh` command). */
  readonly dshPath: string;
  readonly profile: string;
  readonly workspace: string;
  readonly host: string;
  readonly port: number;
  readonly home: string;
  readonly dshHome?: string;
  readonly logDir: string;
  /** Final audited PATH persisted by install and reused by every later action. */
  readonly servicePath?: string;
  readonly servicePathSource?: 'current' | 'minimal' | 'explicit';
  readonly servicePathCapturedAt?: string;
  /** Windows command extension lookup, persisted alongside PATH. */
  readonly servicePathExt?: string;
  /** Human-readable warnings retained in the receipt and dry-run output. */
  readonly servicePathWarnings?: readonly string[];
  /** Absolute launchctl/systemctl/schtasks path; later actions never search PATH. */
  readonly nativeServiceCommand?: string;
  /** Written by the user-service definition, never inferred from a TTY. */
  readonly supervisorMarker: 'dsh-update-status';
}
interface ServicePaths {
  readonly stateFile: string;
  readonly definitionFile: string;
  /** macOS and Windows: the wrapper that owns the restart loop. */
  readonly wrapperFile?: string;
  readonly stdoutFile: string;
  readonly stderrFile: string;
}
interface ServicePlan {
  readonly spec: ServiceSpec;
  readonly paths: ServicePaths;
  readonly definition: string;
  readonly wrapper?: string;
  readonly installCommand: readonly string[];
  readonly startCommand: readonly string[];
  /**
   * One copy-only line that lets the service take over again after it stopped
   * (a tripped start limit, a given-up wrapper). Displayed only — never run by
   * the plugin.
   */
  readonly recoverCommand: string;
  readonly statusCommand: readonly string[];
  readonly stopCommand: readonly string[];
  readonly uninstallCommand: readonly string[];
}
interface CliEnvironment {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  /** Numeric uid needed by launchctl's `gui/<uid>` domain. */
  readonly uid?: number;
  readonly cwd: string;
  readonly execPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly path?: string;
}
interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}
type CommandRunner = (file: string, args: readonly string[]) => CommandResult;
//#endregion
//#region src/service/observe.d.ts
type ServiceVerification = {
  readonly kind: 'settled';
} | {
  readonly kind: 'crash-loop';
  readonly recentRestarts: number;
  readonly windowMs: number;
} | {
  readonly kind: 'not-running';
};
//#endregion
//#region src/service/cli.d.ts
export declare function serialisePlan(plan: ServicePlan): string;
export interface CliHooks {
  readonly preflight?: (spec: ServiceSpec) => void;
  /** Injected in tests; defaults to the real post-activation verification. */
  readonly verify?: (spec: ServiceSpec) => Promise<ServiceVerification>;
}
export declare function main(argv?: readonly string[], env?: CliEnvironment, run?: CommandRunner, hooks?: CliHooks): Promise<number>;
//#endregion