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
  /** Written by the user-service definition, never inferred from a TTY. */
  readonly supervisorMarker: 'dsh-update-status';
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
//#region src/service/cli.d.ts
export interface CliHooks {
  readonly preflight?: (spec: ServiceSpec) => void;
}
export declare function main(argv?: readonly string[], env?: CliEnvironment, run?: CommandRunner, hooks?: CliHooks): Promise<number>;
//#endregion