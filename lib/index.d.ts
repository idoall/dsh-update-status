import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/shared/types.d.ts
declare const RELEASE_CHANNELS: readonly ['latest', 'next', 'alpha'];
type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
type ReleaseCompatibility = 'verified' | 'unverified' | 'incompatible';
type InstallKind = 'npm-global' | 'pnpm-global' | 'source-checkout' | 'unknown';
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
  warning: string | null;
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