import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
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
}
declare class UpdateStatusService {
  private readonly installation;
  private readonly fetchLatest;
  private readonly now;
  private readonly ttlMs;
  private readonly releaseUrl;
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
//#region src/index.d.ts
declare const name = "dsh-update-status";
/** Connection supplies the authenticated transport; settings remains optional. */
declare const inject: string[];
interface Config {
  cacheTtlHours?: number;
  timeoutMs?: number;
  autoCheckOnMount?: boolean;
}
/** Deployment config only controls metadata-check timing; it never authorizes upgrades. */
declare const Config: z<Config>;
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, type InstallKind, type UpdateStatus, UpdateStatusService, apply, inject, name };