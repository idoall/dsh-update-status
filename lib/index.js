import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
//#region src/shared/types.ts
/**
* JSON-only contract shared by the Host and Web halves.
*
* The static package uses the authenticated Connection RPC channel because
* `harness.handle` / `host.call` are dynamic-Cordis-only closure APIs in DSH
* 0.1.2-rc.1. The endpoint vocabulary remains deliberately small and private
* to this plugin channel.
*/
const PLUGIN_ID = "dsh-update-status";
const PACKAGE_NAME = "@deepseek-ai/dsh";
const UPDATE_STATUS_CHANNEL = "/dsh-update-status";
const RELEASE_CHANNELS = [
	"latest",
	"next",
	"alpha"
];
const UPDATE_ENDPOINTS = {
	getStatus: "get-status",
	checkUpdate: "check-update"
};
function isReleaseChannel(value) {
	return value === "latest" || value === "next" || value === "alpha";
}
//#endregion
//#region src/host/installation.ts
/**
* Read-only facts about the DSH process installation. No shell command is run:
* the probe reads only package manifests and Node resolution anchors already
* available to the current Host process.
*/
function manifestAt(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed.name !== "@deepseek-ai/dsh" || typeof parsed.version !== "string" || parsed.version.trim() === "") return void 0;
		return {
			version: parsed.version.trim(),
			root: dirname(path)
		};
	} catch {
		return;
	}
}
function realPath(path) {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}
/** Ascend from an entry file until the owning DSH package manifest is found. */
function manifestFromEntry(entryPath) {
	let directory = dirname(realPath(entryPath));
	for (let depth = 0; depth < 10; depth += 1) {
		const manifest = join(directory, "package.json");
		if (existsSync(manifest)) {
			const found = manifestAt(manifest);
			if (found !== void 0) return {
				...found,
				root: realPath(found.root)
			};
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
}
function manifestFromResolver(resolve) {
	try {
		const found = manifestAt(resolve(PACKAGE_NAME + "/package.json"));
		if (found !== void 0) return {
			...found,
			root: realPath(found.root)
		};
	} catch {}
	try {
		return manifestFromEntry(resolve(PACKAGE_NAME));
	} catch {
		return;
	}
}
function homeResolver(ctx) {
	try {
		const get = ctx.get;
		const dshHomePath = typeof get === "function" ? get.call(ctx, "dshHomePath") : void 0;
		if (typeof dshHomePath !== "function") return void 0;
		const anchor = dshHomePath("profiles", "dsh-update-status-probe.cjs");
		return createRequire(anchor).resolve;
	} catch {
		return;
	}
}
function ownResolver(selfUrl) {
	try {
		return createRequire(selfUrl).resolve;
	} catch {
		return;
	}
}
/**
* Classify only when path evidence is strong. A profile-local mirror must not
* be advertised as an upgradeable global installation, hence the conservative
* unknown fallback.
*/
function classifyInstallRoot(packageRoot, nodePrefix = process.execPath) {
	if (packageRoot === void 0) return "unknown";
	const root = normalize(realPath(packageRoot)).split(sep).join("/");
	const prefix = nodePrefix === void 0 ? "" : normalize(dirname(dirname(nodePrefix))).split(sep).join("/");
	if (!root.includes("/node_modules/") && /\/apps\/cli(?:\/|$)/.test(root)) return "source-checkout";
	if (root.includes("/.pnpm/") || /\/pnpm\/global(?:\/|$)/.test(root)) return "pnpm-global";
	if (prefix !== "" && root.startsWith(prefix + "/lib/node_modules/")) return "npm-global";
	if (/\/lib\/node_modules\/@deepseek-ai\/dsh$/.test(root)) return "npm-global";
	return "unknown";
}
/** Generate guidance only; this package never invokes the string it returns. */
function upgradeCommandFor(installKind, packageName = PACKAGE_NAME, channel = "latest") {
	const specifier = `${packageName}@${channel}`;
	switch (installKind) {
		case "npm-global": return `npm install -g ${specifier}`;
		case "pnpm-global": return `pnpm add -g ${specifier}`;
		case "source-checkout": return "在 DSH checkout 中拉取代码、安装依赖并重新构建；插件不会从 GUI 原地替换";
		default: return "请确认 dsh 安装方式后再升级；当前插件不会代为执行";
	}
}
/**
* Resolve the package that launched this process first, then the DSH home
* mirror and finally this plugin's resolver. All failures degrade safely.
*/
function detectInstallation(ctx, selfUrl = import.meta.url) {
	const argvEntry = typeof process.argv[1] === "string" ? manifestFromEntry(process.argv[1]) : void 0;
	const fromHome = homeResolver(ctx);
	const home = fromHome === void 0 ? void 0 : manifestFromResolver(fromHome);
	const own = ownResolver(selfUrl);
	const local = own === void 0 ? void 0 : manifestFromResolver(own);
	const found = argvEntry ?? home ?? local;
	const installKind = classifyInstallRoot(found?.root);
	const channel = "latest";
	return {
		currentVersion: found?.version ?? "unknown",
		packageName: PACKAGE_NAME,
		channel,
		installKind,
		...found?.root === void 0 ? {} : { packageRoot: found.root },
		upgradeCommand: upgradeCommandFor(installKind, PACKAGE_NAME, channel)
	};
}
//#endregion
//#region src/host/rpc.ts
function failure(code, message) {
	return {
		ok: false,
		error: {
			code,
			message,
			details: {}
		}
	};
}
function requestOf(value) {
	if (value === null || value === void 0) return {};
	if (typeof value !== "object" || Array.isArray(value)) return void 0;
	const record = value;
	if (record.force !== void 0 && typeof record.force !== "boolean") return void 0;
	if (record.channel !== void 0 && !isReleaseChannel(record.channel)) return void 0;
	return {
		...record.force === void 0 ? {} : { force: record.force },
		...record.channel === void 0 ? {} : { channel: record.channel }
	};
}
/** Endpoint dispatcher, exported to allow exact JSON-shape tests without a Host. */
function createUpdateStatusRpcHandler(service) {
	return async (endpoint, payload) => {
		try {
			if (endpoint === UPDATE_ENDPOINTS.getStatus) {
				const request = requestOf(payload);
				if (request === void 0) return failure("dsh-update-status/bad-request", "`force` must be boolean and `channel` must be latest, next, or alpha");
				return {
					ok: true,
					value: await service.getStatus(request.channel)
				};
			}
			if (endpoint === UPDATE_ENDPOINTS.checkUpdate) {
				const request = requestOf(payload);
				if (request === void 0) return failure("dsh-update-status/bad-request", "`force` must be boolean and `channel` must be latest, next, or alpha");
				return {
					ok: true,
					value: await service.check(request.force === true, request.channel)
				};
			}
			return failure("dsh-update-status/unknown-endpoint", `unknown endpoint: ${endpoint}`);
		} catch (error) {
			return failure("dsh-update-status/internal", (error instanceof Error ? error.message : String(error)).slice(0, 220));
		}
	};
}
/**
* Static packages do not receive dynamic Cordis's `harness.handle` closure.
* This registration uses DSH's existing authenticated Connection RPC transport
* and is removed with the plugin fiber.
*/
function installUpdateStatusRpc(ctx, service) {
	const handler = createUpdateStatusRpcHandler(service);
	ctx.inject(["connection"], (connectionCtx) => {
		const connection = connectionCtx.get("connection");
		const handle = typeof connection?.rpc?.handle === "function" ? connection.rpc.handle.bind(connection.rpc) : void 0;
		if (handle === void 0) return;
		connectionCtx.effect(() => {
			const unregister = handle(UPDATE_STATUS_CHANNEL, handler);
			return () => {
				Promise.resolve(unregister()).catch(() => {});
			};
		}, "dsh-update-status: authenticated RPC channel");
	});
}
//#endregion
//#region src/host/settings.ts
const SettingsSchema = z.object({
	sidebarEnabled: z.boolean().default(true),
	channel: z.union([
		"latest",
		"next",
		"alpha"
	]).default("latest").loose()
});
/** Settings are optional composition; absent providers leave the Web default on. */
function installSettings(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		try {
			settingsCtx.settings.register(PLUGIN_ID, SettingsSchema, {
				base: {
					sidebarEnabled: true,
					channel: "latest"
				},
				applies: "live"
			});
		} catch (error) {
			console.error("[dsh-update-status] settings namespace registration failed:", error);
		}
	});
}
//#endregion
//#region src/shared/semver.ts
const SEMVER = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NUMERIC_IDENTIFIER = /^(0|[1-9]\d*)$/;
function parseSemver(value) {
	const match = SEMVER.exec(value.trim());
	if (match === null) return void 0;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return void 0;
	return {
		major,
		minor,
		patch,
		prerelease: match[4] === void 0 ? [] : match[4].split(".")
	};
}
function compareIdentifier(left, right) {
	const leftNumeric = NUMERIC_IDENTIFIER.test(left);
	const rightNumeric = NUMERIC_IDENTIFIER.test(right);
	if (leftNumeric && rightNumeric) return Number(left) - Number(right);
	if (leftNumeric) return -1;
	if (rightNumeric) return 1;
	return left < right ? -1 : left > right ? 1 : 0;
}
/** Returns a negative number when left is older; undefined means unparsable. */
function compareSemver(leftValue, rightValue) {
	const left = parseSemver(leftValue);
	const right = parseSemver(rightValue);
	if (left === void 0 || right === void 0) return void 0;
	for (const key of [
		"major",
		"minor",
		"patch"
	]) if (left[key] !== right[key]) return left[key] - right[key];
	const leftStable = left.prerelease.length === 0;
	const rightStable = right.prerelease.length === 0;
	if (leftStable && rightStable) return 0;
	if (leftStable) return 1;
	if (rightStable) return -1;
	const length = Math.max(left.prerelease.length, right.prerelease.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left.prerelease[index];
		const rightPart = right.prerelease[index];
		if (leftPart === void 0) return -1;
		if (rightPart === void 0) return 1;
		const comparison = compareIdentifier(leftPart, rightPart);
		if (comparison !== 0) return comparison;
	}
	return 0;
}
//#endregion
//#region src/host/update-status.ts
const REGISTRY_URL = "https://registry.npmjs.org/@deepseek-ai%2Fdsh";
const DEFAULT_TIMEOUT_MS = 15e3;
function boundedMessage(error) {
	const trimmed = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
	return trimmed === "" ? "unknown error" : trimmed.slice(0, 220);
}
function warningWith(base, addition) {
	if (base === null || base === "") return addition;
	if (addition === null || addition === "") return base;
	return `${base} ${addition}`;
}
function dateOrNull(value) {
	if (typeof value !== "string" || value === "") return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function compatibilityOf(version) {
	return version === "0.1.2-rc.1" ? "verified" : "unverified";
}
function registryReleaseOf(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("npm registry returned an invalid document");
	const record = value;
	const tags = record["dist-tags"];
	if (tags === null || typeof tags !== "object" || Array.isArray(tags)) throw new Error("npm registry response has no dist-tags");
	const tagRecord = tags;
	const time = record.time;
	const timeRecord = time !== null && typeof time === "object" && !Array.isArray(time) ? time : {};
	const channels = RELEASE_CHANNELS.map((channel) => {
		const raw = tagRecord[channel];
		const version = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
		return {
			channel,
			version,
			publishedAt: version === null ? null : dateOrNull(timeRecord[version]),
			compatibility: compatibilityOf(version)
		};
	});
	if (channels.every((release) => release.version === null)) throw new Error("npm registry response has no supported dist-tags");
	return { channels };
}
/** Only the explicitly approved HTTPS npm Registry authority may be contacted. */
function assertApprovedRegistryUrl(raw) {
	const url = new URL(raw);
	if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.username !== "" || url.password !== "") throw new Error("update check rejected a non-whitelisted registry URL");
	return url;
}
/** Create the default HTTPS-only registry reader. */
function createRegistryFetcher(timeoutMs = DEFAULT_TIMEOUT_MS) {
	const boundedTimeout = Math.max(1e3, Math.min(3e4, Math.floor(timeoutMs)));
	return async () => {
		const url = assertApprovedRegistryUrl(REGISTRY_URL);
		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
		}, boundedTimeout);
		try {
			const response = await fetch(url, {
				method: "GET",
				redirect: "error",
				signal: controller.signal,
				headers: { accept: "application/json" }
			});
			if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
			return registryReleaseOf(await response.json());
		} catch (error) {
			if (controller.signal.aborted) throw new Error(`npm registry timed out after ${boundedTimeout}ms`);
			throw error;
		} finally {
			clearTimeout(timer);
		}
	};
}
var UpdateStatusService = class {
	installation;
	fetchLatest;
	now;
	ttlMs;
	releaseUrl;
	cache;
	inFlight;
	constructor(options) {
		this.installation = options.installation;
		this.fetchLatest = options.fetchLatest ?? createRegistryFetcher();
		this.now = options.now ?? Date.now;
		this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? 216e5));
		this.releaseUrl = options.releaseUrl ?? "https://github.com/deepseek-ai/deepseek-harness/releases";
	}
	getStatus(channel = "latest") {
		return this.check(false, channel);
	}
	/** `force` bypasses TTL but still joins any registry check already in flight. */
	async check(force = false, channel = "latest") {
		const cached = this.cache;
		if (!force && cached !== void 0 && this.now() - cached.checkedAtMs < this.ttlMs) return this.statusFromCache(cached, channel, true, null);
		if (this.inFlight !== void 0) try {
			return this.statusFromCache(await this.inFlight, channel, false, null);
		} catch (error) {
			return this.statusAfterFailure(channel, error);
		}
		const run = this.refreshRelease();
		this.inFlight = run;
		try {
			return this.statusFromCache(await run, channel, false, null);
		} catch (error) {
			return this.statusAfterFailure(channel, error);
		} finally {
			if (this.inFlight === run) this.inFlight = void 0;
		}
	}
	async refreshRelease() {
		const cache = {
			release: await this.fetchLatest(),
			checkedAtMs: this.now()
		};
		this.cache = cache;
		return cache;
	}
	statusAfterFailure(channel, error) {
		const warning = `无法检查 npm registry：${boundedMessage(error)}`;
		return this.cache === void 0 ? this.statusWithoutRemoteRelease(channel, warning) : this.statusFromCache(this.cache, channel, true, warning);
	}
	statusFromCache(cache, channel, cached, initialWarning) {
		const selected = cache.release.channels.find((release) => release.channel === channel) ?? {
			channel,
			version: null,
			publishedAt: null,
			compatibility: "unverified"
		};
		const comparison = selected.version === null ? void 0 : compareSemver(this.installation.currentVersion, selected.version);
		const missingWarning = selected.version === null ? `npm registry 未发布 ${channel} 通道。` : null;
		const comparisonWarning = selected.version !== null && comparison === void 0 ? `无法按 SemVer 比较当前版本 ${this.installation.currentVersion} 与 ${channel} 通道版本 ${selected.version}。` : null;
		const previewWarning = channel !== "latest" && selected.version !== null && selected.compatibility !== "verified" ? `${channel} 是预览通道，版本 ${selected.version} 尚未验证与本插件兼容。` : null;
		return {
			currentVersion: this.installation.currentVersion,
			latestVersion: selected.version,
			hasUpdate: comparison !== void 0 && comparison < 0,
			cached,
			checkedAt: new Date(cache.checkedAtMs).toISOString(),
			warning: warningWith(warningWith(initialWarning, missingWarning), warningWith(comparisonWarning, previewWarning)),
			installKind: this.installation.installKind,
			upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || "@deepseek-ai/dsh", channel),
			releaseUrl: this.releaseUrl,
			changelogUrl: this.releaseUrl,
			publishedAt: selected.publishedAt,
			packageName: this.installation.packageName || "@deepseek-ai/dsh",
			channel,
			channels: cache.release.channels,
			canApplyInPlace: false
		};
	}
	statusWithoutRemoteRelease(channel, warning) {
		return {
			currentVersion: this.installation.currentVersion,
			latestVersion: null,
			hasUpdate: false,
			cached: false,
			checkedAt: null,
			warning,
			installKind: this.installation.installKind,
			upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || "@deepseek-ai/dsh", channel),
			releaseUrl: this.releaseUrl,
			changelogUrl: this.releaseUrl,
			publishedAt: null,
			packageName: this.installation.packageName || "@deepseek-ai/dsh",
			channel,
			channels: RELEASE_CHANNELS.map((item) => ({
				channel: item,
				version: null,
				publishedAt: null,
				compatibility: "unverified"
			})),
			canApplyInPlace: false
		};
	}
};
//#endregion
//#region src/index.ts
const name = "dsh-update-status";
/** Connection supplies the authenticated transport; settings remains optional. */
const inject = ["connection"];
/** Deployment config only controls metadata-check timing; it never authorizes upgrades. */
const Config = z.object({
	cacheTtlHours: z.number().step(1).min(1).max(24).default(6),
	timeoutMs: z.number().step(1).min(1e3).max(3e4).default(DEFAULT_TIMEOUT_MS),
	autoCheckOnMount: z.boolean().default(true)
});
function boundedNumber(value, fallback, min, max) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}
function apply(ctx, config = {}) {
	const ttlHours = boundedNumber(config.cacheTtlHours, 6, 1, 24);
	const timeoutMs = boundedNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1e3, 3e4);
	const service = new UpdateStatusService({
		installation: detectInstallation(ctx),
		fetchLatest: createRegistryFetcher(timeoutMs),
		ttlMs: ttlHours * 60 * 60 * 1e3
	});
	installSettings(ctx);
	installUpdateStatusRpc(ctx, service);
	if (config.autoCheckOnMount !== false) service.getStatus();
}
//#endregion
export { Config, UpdateStatusService, apply, inject, name };
