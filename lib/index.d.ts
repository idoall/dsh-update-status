import { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
//#region src/shared/types.d.ts
declare const RELEASE_CHANNELS: readonly ['latest', 'next', 'alpha'];
type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
type ReleaseCompatibility = 'verified' | 'unverified' | 'incompatible';
/**
 * Severity of `warning`, so a surface can tell "the plugin could not determine
 * the update state" from "here is something worth knowing".
 *
 * - `failure`: no usable answer — a failed registry read, a channel the registry
 *   does not publish, or a version SemVer cannot compare. This is what justifies
 *   repainting the sidebar chip.
 * - `notice`: the answer is complete and usable; the text is advisory, e.g. a
 *   preview channel whose release this bundle has not been verified against.
 *   The chip must NOT repaint for this — an operator upgrading DSH ahead of the
 *   plugin would otherwise see the chip turn red for a plugin-side bookkeeping
 *   fact.
 *
 * Optional on purpose: a Host older than this field leaves it `undefined`, and
 * the client then falls back to treating any warning as a failure.
 */
type UpdateWarningKind = 'failure' | 'notice';
type InstallKind = 'npm-global' | 'pnpm-global' | 'source-checkout' | 'unknown';
/** Language-neutral warning facts; the browser renders them in its own locale. */
type UpdateWarning = {
  code: 'registry-unavailable';
  detail: string;
} | {
  code: 'channel-unavailable';
  channel: ReleaseChannel;
} | {
  code: 'version-incomparable';
  currentVersion: string;
  channel: ReleaseChannel;
  selectedVersion: string;
} | {
  code: 'preview-unverified';
  channel: ReleaseChannel;
  version: string;
} |
/**
 * The Host resolved a `@deepseek-ai/schemastery` that DSH does not ship, so the
 * Loader's volatile projection is unavailable and the preference fields cannot
 * be marked volatile. Advisory: the version answer itself is complete, and the
 * text carries the exact directory to remove. See `host/schemastery.ts`.
 */
{
  code: 'stale-schemastery';
  version: string | null;
  path: string;
  nodeModulesDir: string | null;
};
interface ChannelRelease {
  channel: ReleaseChannel;
  version: string | null;
  publishedAt: string | null;
  compatibility: ReleaseCompatibility;
}
/**
 * A lossless, JSON-serializable snapshot used by both browser surfaces.
 * Nulls are intentional: a failed first check must still render a truthful
 * current-version card instead of an empty or malformed UI.
 */
interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  cached: boolean;
  checkedAt: string | null;
  /** English fallback for older clients; current clients localize `warnings`. */
  warning: string | null;
  /** Severity of `warning`; absent from a Host older than the field. */
  warningKind?: UpdateWarningKind | null;
  /** Structured warning facts; absent from a Host older than this field. */
  warnings?: UpdateWarning[];
  installKind: InstallKind;
  upgradeCommand: string;
  releaseUrl: string;
  changelogUrl: string;
  publishedAt: string | null;
  packageName: string;
  /** Selected npm dist-tag used for comparison and command generation. */
  channel: ReleaseChannel;
  /** All supported dist-tags returned by the same cached registry request. */
  channels: ChannelRelease[];
  /** Phase 1 is informational only; the GUI must never apply an update. */
  canApplyInPlace: false;
}
//#endregion
//#region src/host/settings.d.ts
/** Deployment config (ordinary) plus the volatile user preferences the form edits. */
interface UpdateStatusConfig {
  /** Deployment: on-demand registry cache duration, in hours. */
  cacheTtlHours?: number;
  /** Deployment: registry request timeout, in milliseconds. */
  timeoutMs?: number;
  /** Deployment: run one metadata check when the process mounts the plugin. */
  autoCheckOnMount?: boolean;
  /** Preference: show the sidebar version chip and its update panel. */
  sidebarEnabled?: boolean;
  /** Preference: release channel followed for comparison and commands. */
  channel?: ReleaseChannel;
  /** Preference: on-demand registry cache duration, in minutes. */
  cacheTtlMinutes?: number;
}
/**
 * The plugin's Config schema; its volatile fields ARE the settings form.
 *
 * The explicit two-argument annotation is load-bearing: a `.volatile()` field's
 * output is a stable reference (`Volatile<T>`) rather than the bare value the
 * input side takes, so the inferred schema type cannot be named by the emitted
 * `.d.ts` (TS2883) without stating the input side here. The builder preserves
 * that contract even on the degraded path, where no field is volatile.
 */
export declare const Config: z<UpdateStatusConfig, Record<string, unknown>>;
//#endregion
//#region src/host/installation.d.ts
interface InstallationInfo {
  currentVersion: string;
  packageName: string;
  channel: string;
  installKind: InstallKind;
  packageRoot?: string;
  upgradeCommand: string;
}
//#endregion
//#region src/host/update-status.d.ts
interface RegistryRelease {
  channels: ChannelRelease[];
}
type RegistryFetcher = () => Promise<RegistryRelease>;
interface UpdateStatusServiceOptions {
  installation: InstallationInfo;
  fetchLatest?: RegistryFetcher;
  now?: () => number;
  ttlMs?: number;
  releaseUrl?: string;
  /**
   * Facts about this process's own runtime, appended to every status. The schema
   * resolution is the only producer today; the registry read never sets these.
   */
  runtimeWarnings?: readonly UpdateWarning[];
}
export declare class UpdateStatusService {
  private readonly installation;
  private readonly fetchLatest;
  private readonly now;
  private readonly ttlMs;
  private readonly releaseUrl;
  private readonly runtimeWarnings;
  private cache;
  private inFlight;
  constructor(options: UpdateStatusServiceOptions);
  getStatus(channel?: ReleaseChannel, cacheTtlMinutes?: number): Promise<UpdateStatus>;
  /** `force` bypasses TTL but still joins any registry check already in flight. */
  check(force?: boolean, channel?: ReleaseChannel, cacheTtlMinutes?: number): Promise<UpdateStatus>;
  private refreshRelease;
  private statusAfterFailure;
  private statusFromCache;
  private statusWithoutRemoteRelease;
}
//#endregion
//#region src/host/schemastery.d.ts
/** Where a candidate copy of schemastery was looked for. */
type SchemaCandidateSource = 'dsh-install' | 'profile-peers' | 'profile-local' | 'plugin-local';
interface SchemaCandidate {
  source: SchemaCandidateSource;
  /** Absolute file path `createRequire` anchors on; the file need not exist. */
  anchor: string;
}
interface SchemaCandidateReport {
  source: SchemaCandidateSource;
  anchor: string;
  /** Absolute path of the module that loaded, or null when it did not load. */
  path: string | null;
  version: string | null;
  /** The loaded module exposes `volatile()`. */
  volatile: boolean;
  /** Why this candidate was skipped, or null when it loaded. */
  error: string | null;
}
interface SchemaRuntime {
  /** The loaded schemastery factory — structurally the package's default export. */
  z: unknown;
  volatile: boolean;
  source: SchemaCandidateSource;
  path: string | null;
  version: string | null;
  /** Every candidate that was tried, in order, for diagnostics. */
  candidates: SchemaCandidateReport[];
  /** Set when the resolved copy cannot project volatile preferences. */
  warning: UpdateWarning | null;
}
interface ResolveSchemaRuntimeOptions {
  /** Override the candidate order; used by tests and by an embedding host. */
  candidates?: readonly SchemaCandidate[];
}
/**
 * Resolve schemastery once, preferring the copy that can actually do the job.
 *
 * Only a total miss throws, and only with the per-candidate reasons attached:
 * that state means the plugin is not running inside a working DSH installation,
 * so there is no schema system to build a settings form with. Every other
 * outcome loads.
 */
export declare function resolveSchemaRuntime(options?: ResolveSchemaRuntimeOptions): SchemaRuntime;
/**
 * The process-wide resolution, computed on first use.
 *
 * The settings schema is built at module scope — the Loader reads the exported
 * `Config` before `apply` runs — so the resolution cannot wait for a Host
 * context. Every input here comes from the process environment or the filesystem.
 */
export declare function schemaRuntime(): SchemaRuntime;
//#endregion
//#region src/index.d.ts
export declare const name = "dsh-update-status";
/** Connection supplies the authenticated transport; settings remains optional. */
export declare const inject: string[];
export type Config = UpdateStatusConfig;
export declare function apply(ctx: Context, config?: Config): void;
//#endregion
export type { InstallKind, SchemaRuntime, UpdateStatus };