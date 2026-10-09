import { C as recordBootStamp, S as dshHomeOf, _ as parseSystemdMainPid, a as planFor, b as bootStampFile, f as LAUNCHD_LABEL, g as parseLaunchdTrackedPid, p as SYSTEMD_UNIT, w as serviceLogDir, x as countRecentRestarts, y as RESTART_STORM_WINDOW_MS } from "./plan-D9Ybaj-3.js";
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
//#region src/shared/types.ts
const PACKAGE_NAME = "@deepseek-ai/dsh";
/** Shared Connection RPC channel. Custom prefixes 405 on the SPA fallback. */
const UPDATE_STATUS_CHANNEL = "/api";
/**
* DSH releases this bundle has actually been verified against. The same list is
* declared in package.json's `dsh.compatibility.dshReleases`, and every other
* release the registry reports stays `unverified` — the plugin never claims a
* compatibility nobody checked.
*/
const VERIFIED_DSH_VERSIONS = [
	"0.1.7-alpha.2",
	"0.1.7-rc.1",
	"0.1.7-rc.2",
	"0.2.0-rc.1",
	"0.2.0-rc.2",
	"0.2.1-alpha.1"
];
function isCacheTtlMinutes(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 1440;
}
const UPDATE_ENDPOINTS = {
	getStatus: "dsh-update-status.get-status",
	checkUpdate: "dsh-update-status.check-update"
};
/** Restart RPC remains on the same authenticated Connection `/api` channel. */
const RESTART_ENDPOINTS = {
	status: "dsh-update-status.restart-status",
	check: "dsh-update-status.restart-check",
	request: "dsh-update-status.restart"
};
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
function realPath$1(path) {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}
/** Ascend from an entry file until the owning DSH package manifest is found. */
function manifestFromEntry(entryPath) {
	let directory = dirname(realPath$1(entryPath));
	for (let depth = 0; depth < 10; depth += 1) {
		const manifest = join(directory, "package.json");
		if (existsSync(manifest)) {
			const found = manifestAt(manifest);
			if (found !== void 0) return {
				...found,
				root: realPath$1(found.root)
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
			root: realPath$1(found.root)
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
	const root = normalize(realPath$1(packageRoot)).split(sep).join("/");
	const prefix = nodePrefix === void 0 ? "" : normalize(dirname(dirname(nodePrefix))).split(sep).join("/");
	if (!root.includes("/node_modules/") && /\/apps\/cli(?:\/|$)/.test(root)) return "source-checkout";
	if (root.includes("/.pnpm/") || /\/pnpm\/global(?:\/|$)/.test(root)) return "pnpm-global";
	if (prefix !== "" && root.startsWith(prefix + "/lib/node_modules/")) return "npm-global";
	if (/\/lib\/node_modules\/@deepseek-ai\/dsh$/.test(root)) return "npm-global";
	return "unknown";
}
/**
* Generate guidance only; this package never invokes the string it returns.
*
* The target is the exact version the check found, not a dist-tag: with a single
* release line there is no followed tag left to name, and `@0.2.1-alpha.1` cannot
* be re-pointed between the check and the terminal.
*/
function upgradeCommandFor(installKind, packageName = PACKAGE_NAME, version = null) {
	const specifier = version === null ? packageName : `${packageName}@${version}`;
	switch (installKind) {
		case "npm-global": return `npm install -g ${specifier}`;
		case "pnpm-global": return `pnpm add -g ${specifier}`;
		case "source-checkout": return "Update the DSH source checkout, install its dependencies, and rebuild it; this plugin cannot replace it in place from the GUI";
		default: return "Confirm how DSH was installed before upgrading; this plugin cannot perform the upgrade for you";
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
	return {
		currentVersion: found?.version ?? "unknown",
		packageName: PACKAGE_NAME,
		installKind,
		...found?.root === void 0 ? {} : { packageRoot: found.root }
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
	if (record.cacheTtlMinutes !== void 0 && !isCacheTtlMinutes(record.cacheTtlMinutes)) return void 0;
	return {
		...record.force === void 0 ? {} : { force: record.force },
		...record.cacheTtlMinutes === void 0 ? {} : { cacheTtlMinutes: record.cacheTtlMinutes }
	};
}
function restartRequestOf(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
	const record = value;
	if (record.force !== void 0 && typeof record.force !== "boolean") return void 0;
	if (typeof record.expectedInstanceId !== "string" || record.expectedInstanceId === "") return void 0;
	return {
		force: record.force === true,
		expectedInstanceId: record.expectedInstanceId
	};
}
function jsonResponse(rpcId, result) {
	return Response.json({
		type: "server-response",
		rpcId,
		result
	});
}
/** Envelope-compatible Fetch adapter for one namespaced `/api` endpoint. */
async function dispatchUpdateStatusFetch(endpoint, handler, request) {
	if (request.method !== "POST") return new Response("not found", { status: 404 });
	if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });
	let body;
	try {
		body = await request.json();
	} catch {
		return new Response("body is not JSON", { status: 400 });
	}
	const record = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
	const rpcId = typeof record.rpcId === "string" ? record.rpcId : "invalid-request";
	if (record.type !== "client-request" || record.method !== endpoint) return jsonResponse(rpcId, failure("gateway/bad-request", "invalid client-request message"));
	try {
		return jsonResponse(rpcId, await handler(endpoint, record.payload, request.signal));
	} catch (error) {
		return new Response(`handler failure: ${String(error)}`, { status: 500 });
	}
}
/** Endpoint dispatcher, exported to allow exact JSON-shape tests without a Host. */
function createUpdateStatusRpcHandler(service, restart, restartContext) {
	return async (endpoint, payload) => {
		try {
			if (endpoint === UPDATE_ENDPOINTS.getStatus) {
				const request = requestOf(payload);
				if (request === void 0) return failure("dsh-update-status/bad-request", "`force` must be boolean and `cacheTtlMinutes` must be an integer from 30 to 1440");
				return {
					ok: true,
					value: await service.getStatus(request.cacheTtlMinutes)
				};
			}
			if (endpoint === UPDATE_ENDPOINTS.checkUpdate) {
				const request = requestOf(payload);
				if (request === void 0) return failure("dsh-update-status/bad-request", "`force` must be boolean and `cacheTtlMinutes` must be an integer from 30 to 1440");
				return {
					ok: true,
					value: await service.check(request.force === true, request.cacheTtlMinutes)
				};
			}
			if (endpoint === RESTART_ENDPOINTS.status) {
				if (restart === void 0) return failure("dsh-update-status/restart-unavailable", "restart support is not configured");
				return {
					ok: true,
					value: await restart.assess()
				};
			}
			if (endpoint === RESTART_ENDPOINTS.check) {
				if (restart === void 0 || restartContext === void 0) return failure("dsh-update-status/restart-unavailable", "restart support is not configured");
				return {
					ok: true,
					value: await restart.check(restartContext)
				};
			}
			if (endpoint === RESTART_ENDPOINTS.request) {
				const request = restartRequestOf(payload);
				if (request === void 0) return failure("dsh-update-status/bad-request", "`force` must be boolean");
				if (restart === void 0 || restartContext === void 0) return failure("dsh-update-status/restart-unavailable", "restart support is not configured");
				return {
					ok: true,
					value: await restart.request(restartContext, request.force, request.expectedInstanceId)
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
* Exact Fetch routes on `/api/<endpoint>` are dispatched by Connection after
* its Host/Origin and cookie admission. Every destructive restart request is
* therefore authenticated before it reaches this plugin.
*/
function installUpdateStatusRpc(ctx, service, restart) {
	const handler = createUpdateStatusRpcHandler(service, restart, ctx);
	ctx.inject(["connection"], (owned) => {
		const connection = owned.connection;
		const register = typeof connection.fetch?.register === "function" ? connection.fetch.register.bind(connection.fetch) : void 0;
		if (register === void 0) return;
		try {
			for (const endpoint of [...Object.values(UPDATE_ENDPOINTS), ...Object.values(RESTART_ENDPOINTS)]) register({
				path: `${UPDATE_STATUS_CHANNEL}/${endpoint}`,
				methods: ["POST"],
				requestBody: "buffered",
				fetch: (request) => dispatchUpdateStatusFetch(endpoint, handler, request)
			});
		} catch (error) {
			console.error("[dsh-update-status] authenticated RPC route registration failed:", error);
		}
	});
}
//#endregion
//#region src/host/service-record.ts
/**
* What the *service* is, read back from our own installer receipt.
*
* The panel must be able to tell an operator how to get supervision back after
* it was lost — a restart storm tripped the wrapper's ceiling, or another tool's
* instance took the port. Those steps are platform commands, and the plugin
* never guesses them: the installer wrote the receipt, so the receipt is where
* the port and the matching recover command come from.
*
* Read-only and best effort. A missing, foreign or unreadable receipt simply
* means "no recovery hint", never an error on a status route.
*/
const SERVICE_RECEIPT_FILE = "dsh-update-status-service.json";
/** Whoever is listening on the port, without touching it — per platform. */
function portListCommand(platform, port) {
	if (platform === "win32") return `netstat -ano | findstr :${String(port)}`;
	return `lsof -nP -iTCP:${String(port)} -sTCP:LISTEN`;
}
function specOf(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
	const spec = value;
	if (spec.platform !== "darwin" && spec.platform !== "linux" && spec.platform !== "win32") return void 0;
	if (typeof spec.port !== "number" || !Number.isInteger(spec.port) || spec.port < 1 || spec.port > 65535) return void 0;
	if (typeof spec.label !== "string" || spec.label === "") return void 0;
	for (const field of [
		spec.nodePath,
		spec.dshPath,
		spec.profile,
		spec.workspace,
		spec.host,
		spec.home,
		spec.logDir
	]) if (typeof field !== "string" || field === "") return void 0;
	if (spec.supervisorMarker !== "dsh-update-status") return void 0;
	return spec;
}
const CACHE_TTL_MS = 3e4;
/**
* Cached for a short window: the receipt changes only when the operator re-installs,
* and this runs on every restart-status poll while a restart is unavailable.
*/
function createServiceRecovery(options = {}) {
	const now = options.now ?? Date.now;
	const read = options.readFile ?? ((path) => {
		try {
			if (!existsSync(path) || !statSync(path).isFile()) return void 0;
			return readFileSync(path, "utf8");
		} catch {
			return;
		}
	});
	let cached;
	return () => {
		const at = now();
		if (cached !== void 0 && at - cached.at < CACHE_TTL_MS) return cached.value;
		const value = readRecovery(options, read);
		cached = {
			at,
			value
		};
		return value;
	};
}
function readRecovery(options, read) {
	const text = read(join(dshHomeOf(options.env ?? process.env), SERVICE_RECEIPT_FILE));
	if (text === void 0) return void 0;
	try {
		const receipt = JSON.parse(text);
		if (receipt.version !== 1 || receipt.managedBy !== "dsh-update-status") return void 0;
		const spec = specOf(receipt.spec);
		if (spec === void 0) return void 0;
		const plan = planFor(spec, options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0));
		return { commands: `${portListCommand(spec.platform, spec.port)}\n${plan.recoverCommand}` };
	} catch {
		return;
	}
}
//#endregion
//#region src/host/supervision.ts
/**
* Platform ownership of the running DSH Web process, plus restart-storm evidence.
*
* The environment marker (`DSH_WEB_SUPERVISOR`) is necessary but *not* sufficient:
* every descendant of a supervised process inherits it. A foreign launcher — a
* second plugin's restart helper, a `nohup` script — therefore looks supervised
* while the real job is stuck respawning a process that can never bind the port.
* The panel would offer a destructive restart and promise a recovery the platform
* cannot deliver, so ownership is asked of the platform itself:
*
* - launchd: the tracked pid of our fixed job label must be this process or its
*   wrapper parent (asked by label, never from the environment);
* - systemd: the unit's `MainPID` must be this process or its wrapper parent;
* - Task Scheduler: the parent process must be the wrapper this plugin installed.
*
* Anything unverifiable fails closed: restart is destructive, and a false "yes"
* strands the page, while a false "no" only asks the user to restart DSH by hand.
*/
function defaultRun(file, args) {
	return new Promise((resolve) => {
		execFile(file, [...args], {
			encoding: "utf8",
			timeout: 5e3,
			windowsHide: true
		}, (error, stdout, stderr) => {
			const code = error === null ? 0 : error.code;
			resolve({
				status: typeof code === "number" ? code : error === null ? 0 : null,
				stdout: stdout ?? "",
				stderr: stderr ?? "",
				...error === null ? {} : { error: error.message }
			});
		});
	});
}
async function probeSupervisorOwnership(options = {}) {
	const platform = options.platform ?? process.platform;
	const pid = options.pid ?? process.pid;
	const ppid = options.ppid ?? process.ppid;
	const run = options.run ?? defaultRun;
	try {
		if (platform === "darwin") {
			const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : void 0);
			if (uid === void 0) return "unverifiable";
			const result = await run("/bin/launchctl", ["print", `gui/${String(uid)}/${LAUNCHD_LABEL}`]);
			if (result.status === null && result.error !== void 0) return "unverifiable";
			const tracked = parseLaunchdTrackedPid(result.stdout);
			if (tracked === void 0) return "not-owner";
			return tracked === pid || tracked === ppid ? "owned" : "not-owner";
		}
		if (platform === "linux") {
			const result = await run("systemctl", [
				"--user",
				"show",
				SYSTEMD_UNIT,
				"-p",
				"MainPID",
				"--value"
			]);
			if (result.status === null && result.error !== void 0) return "unverifiable";
			const tracked = parseSystemdMainPid(result.stdout);
			if (tracked === void 0) return "not-owner";
			return tracked === pid || tracked === ppid ? "owned" : "not-owner";
		}
		if (platform === "win32") {
			const result = await run("powershell.exe", [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`(Get-CimInstance Win32_Process -Filter "ProcessId=${String(ppid)}").CommandLine`
			]);
			if (result.status === null && result.error !== void 0) return "unverifiable";
			return result.stdout.includes("dsh-web-supervisor.ps1") ? "owned" : "not-owner";
		}
		return "unverifiable";
	} catch {
		return "unverifiable";
	}
}
/**
* Ownership is cheap to cache: the answer cannot change while a restart is not in
* flight, and the status route is polled by every open panel.
*/
function cacheOwnershipProbe(probe, ttlMs = 1e4, now = Date.now) {
	let cached;
	let inflight;
	return async () => {
		if (cached !== void 0 && now() - cached.at < ttlMs) return cached.verdict;
		if (inflight !== void 0) return inflight;
		inflight = probe().catch(() => "unverifiable").then((verdict) => {
			cached = {
				at: now(),
				verdict
			};
			return verdict;
		}).finally(() => {
			inflight = void 0;
		});
		return inflight;
	};
}
function classifySupervisorHealth(ownership, recentRestarts, windowMs = RESTART_STORM_WINDOW_MS, threshold = 4) {
	if (ownership === "unverifiable") return { kind: "unverifiable" };
	if (ownership === "not-owner") return { kind: "not-owner" };
	if (recentRestarts >= threshold) return {
		kind: "thrashing",
		recentRestarts,
		windowMs
	};
	return { kind: "owned" };
}
/**
* Ownership first, storm second: "not the supervisor's own process" is the more
* precise explanation whenever both are true.
*/
function createSupervisorHealth(options) {
	const now = options.now ?? Date.now;
	const windowMs = options.windowMs ?? 18e4;
	const threshold = options.threshold ?? 4;
	const probe = options.probe ?? cacheOwnershipProbe(() => probeSupervisorOwnership(), 1e4, now);
	return async () => {
		const ownership = await probe();
		if (ownership !== "owned") return classifySupervisorHealth(ownership, 0, windowMs, threshold);
		return classifySupervisorHealth(ownership, countRecentRestarts(options.logDir, options.bootLog, now(), windowMs), windowMs, threshold);
	};
}
const BOOT_STAMPED = Symbol.for("dsh-update-status/boot-stamped");
/**
* One stamp per Node process, not per plugin composition: DSH can recompose this
* plugin (HMR) inside a generation that already stamped itself, and counting
* those would fake a storm.
*/
function recordBootOnce(stamp, path = bootStampFile()) {
	const carrier = globalThis;
	if (carrier[BOOT_STAMPED] === true) return false;
	carrier[BOOT_STAMPED] = true;
	recordBootStamp(path, stamp);
	return true;
}
const INSTANCE_KEY = Symbol.for("dsh-update-status/process-instance-id");
const STARTED_AT_KEY = Symbol.for("dsh-update-status/process-started-at");
/**
* This must outlive plugin HMR/recomposition inside one Node process. A module
* local random value would make a Host reload look like a successful restart.
*/
function processInstanceId() {
	const carrier = globalThis;
	const existing = carrier[INSTANCE_KEY];
	if (existing !== void 0) return existing;
	const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	carrier[INSTANCE_KEY] = created;
	return created;
}
/**
* Wall-clock start of this process, derived once from `process.uptime()` — the
* one clock the Host owns without extra bookkeeping. It is cached on globalThis
* for the same reason as the instance id: a recomposed plugin must keep reporting
* the start of the process it is running in, not the moment it was recomposed.
*/
function processStartedAt() {
	const carrier = globalThis;
	const existing = carrier[STARTED_AT_KEY];
	if (existing !== void 0) return existing;
	const created = new Date(Date.now() - Math.round(process.uptime() * 1e3)).toISOString();
	carrier[STARTED_AT_KEY] = created;
	return created;
}
/**
* The environment/platform half of the verdict: which supervisor this process
* *claims* to be running under.
*
* The explicit marker is never inherited by accident, but every descendant of a
* supervised process does inherit it, so this function alone can only report a
* claim. What turns a claim into an answer is `assess()` below, which asks the
* platform which process the service actually owns. The platform identity is
* deliberately NOT read from the environment: launchd configures
* `XPC_SERVICE_NAME=<label>` for the job, yet a DSH process behind the staged
* `/bin/sh` wrapper reads `XPC_SERVICE_NAME=0`, so an environment check would
* refuse the very setup this plugin installs.
*/
function restartStatusOf(options = {}) {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const versions = options.versions ?? process.versions;
	const instanceId = options.instanceId ?? processInstanceId();
	const startedAt = options.startedAt ?? processStartedAt();
	if (versions.electron !== void 0 && versions.electron !== "") return {
		instanceId,
		startedAt,
		available: false,
		supervisor: null,
		unavailableReason: "desktop"
	};
	if (env.DSH_WEB_SUPERVISOR !== "dsh-update-status") return {
		instanceId,
		startedAt,
		available: false,
		supervisor: null,
		unavailableReason: "not-supervised"
	};
	if (platform === "darwin") return {
		instanceId,
		startedAt,
		available: true,
		supervisor: "launchd",
		unavailableReason: null
	};
	if (platform === "linux") return {
		instanceId,
		startedAt,
		available: true,
		supervisor: "systemd",
		unavailableReason: null
	};
	if (platform === "win32") return {
		instanceId,
		startedAt,
		available: true,
		supervisor: "task-scheduler",
		unavailableReason: null
	};
	return {
		instanceId,
		startedAt,
		available: false,
		supervisor: "unknown",
		unavailableReason: "supervisor-mismatch"
	};
}
/** Same facts dsh-service lists before allowing its force-restart control. */
function collectActiveWork(ctx) {
	const unavailable = () => ({
		available: false,
		hasActive: false,
		items: []
	});
	const getter = typeof ctx.get === "function" ? ctx.get.bind(ctx) : void 0;
	if (getter === void 0) return unavailable();
	let agentsFace;
	let jobsFace;
	try {
		agentsFace = getter("agents");
		jobsFace = getter("jobs");
	} catch {
		return unavailable();
	}
	if (typeof agentsFace?.list !== "function") return unavailable();
	let agents;
	try {
		agents = agentsFace.list();
	} catch {
		return unavailable();
	}
	const items = [];
	for (const agent of agents) {
		if (agent.status !== "running") continue;
		const id = String(agent.id);
		items.push({
			type: "agent",
			id,
			label: id,
			status: "running"
		});
	}
	if (jobsFace !== void 0) {
		if (typeof jobsFace.list !== "function") return unavailable();
		const byId = /* @__PURE__ */ new Map();
		for (const caller of [void 0, ...agents.map((agent) => agent.id)]) try {
			for (const job of jobsFace.list(caller)) {
				if (job.status !== "running" && job.status !== "stopping") continue;
				byId.set(String(job.id), job);
			}
		} catch {
			return unavailable();
		}
		for (const job of byId.values()) items.push({
			type: "job",
			id: String(job.id),
			label: typeof job.label === "string" && job.label !== "" ? job.label : String(job.id),
			status: typeof job.status === "string" ? job.status : "running",
			...job.owner === void 0 ? {} : { ownerSession: String(job.owner) }
		});
	}
	const terminals = /* @__PURE__ */ new Map();
	for (const owner of agents) {
		const ownerCtx = owner.ctx;
		if (ownerCtx === void 0 || typeof ownerCtx.get !== "function") return unavailable();
		let face;
		try {
			face = ownerCtx.get("terminals");
		} catch {
			return unavailable();
		}
		if (face === void 0) continue;
		if (typeof face.list !== "function") return unavailable();
		try {
			for (const terminal of face.list(owner)) {
				if (terminal.status?.kind !== "running") continue;
				terminals.set(String(terminal.sessionId), terminal);
			}
		} catch {
			return unavailable();
		}
	}
	for (const terminal of terminals.values()) {
		const id = String(terminal.sessionId);
		items.push({
			type: "terminal",
			id,
			label: typeof terminal.name === "string" && terminal.name !== "" ? terminal.name : `${typeof terminal.type === "string" ? terminal.type : "terminal"} terminal`,
			status: "running"
		});
	}
	return {
		available: true,
		hasActive: items.length > 0,
		items
	};
}
var RestartController = class {
	instanceId;
	options;
	health;
	recovery;
	scheduled = false;
	constructor(options = {}) {
		this.options = options;
		this.instanceId = options.instanceId ?? processInstanceId();
		this.health = options.health;
		this.recovery = options.recovery;
	}
	status() {
		return restartStatusOf({
			...this.options,
			instanceId: this.instanceId
		});
	}
	/**
	* The environment verdict plus what only the platform knows: whether this
	* process is the one its supervisor is actually tracking, and whether a restart
	* storm says the supervisor cannot complete a start at all. A probe that throws
	* is treated as unverifiable, because restart is destructive.
	*/
	async assess() {
		const base = this.status();
		if (!base.available) return this.withRecovery(base);
		let health;
		if (this.health === void 0) health = { kind: "unverifiable" };
		else try {
			health = await this.health();
		} catch {
			health = { kind: "unverifiable" };
		}
		if (health.kind === "thrashing") return this.withRecovery({
			...base,
			available: false,
			unavailableReason: "supervisor-thrashing"
		});
		if (health.kind === "not-owner" || health.kind === "unverifiable") return this.withRecovery({
			...base,
			available: false,
			unavailableReason: "supervisor-mismatch"
		});
		return base;
	}
	/** A refused restart carries the steps back; an offerable one does not need them. */
	withRecovery(status) {
		if (this.recovery === void 0) return status;
		let recovery;
		try {
			recovery = this.recovery();
		} catch {
			recovery = void 0;
		}
		return recovery === void 0 ? status : {
			...status,
			recovery
		};
	}
	async check(ctx) {
		const status = await this.assess();
		if (!status.available) return {
			kind: "unavailable",
			status
		};
		const activity = collectActiveWork(ctx);
		if (!activity.available) return {
			kind: "unavailable",
			status: {
				...status,
				available: false,
				unavailableReason: "activity-unavailable"
			}
		};
		if (activity.hasActive) return {
			kind: "active-work",
			status,
			activity
		};
		return {
			kind: "ready",
			status
		};
	}
	async request(ctx, force, expectedInstanceId) {
		if (expectedInstanceId !== this.instanceId) return {
			kind: "unavailable",
			status: {
				...this.status(),
				available: false,
				unavailableReason: "stale-instance"
			}
		};
		const checked = await this.check(ctx);
		if (checked.kind === "unavailable") return checked;
		if (checked.kind === "active-work" && !force) return checked;
		if (this.scheduled) return {
			kind: "in-progress",
			instanceId: this.instanceId
		};
		let timer;
		try {
			timer = ctx.get?.("timer");
		} catch {
			timer = void 0;
		}
		const schedule = typeof timer?.timeout === "function" ? (callback) => {
			timer.timeout(callback, 500);
		} : this.options.schedule === void 0 ? void 0 : (callback) => {
			this.options.schedule(callback, 500);
		};
		if (schedule === void 0) return {
			kind: "unavailable",
			status: {
				...this.status(),
				available: false,
				unavailableReason: "timer-unavailable"
			}
		};
		this.scheduled = true;
		const exit = this.options.exit ?? ((code) => process.exit(code));
		schedule(() => {
			exit(42);
		});
		return {
			kind: "scheduled",
			instanceId: this.instanceId
		};
	}
};
/**
* Creates the process-scoped controller once per DSH Host generation.
*
* The health probe is wired here rather than inside the CLI's plan so the Host
* and the installer agree on where the evidence lives: `$DSH_HOME/logs`.
*/
function createRestartController(options = {}) {
	const env = options.env ?? process.env;
	const health = options.health ?? createSupervisorHealth({
		logDir: serviceLogDir(env),
		bootLog: bootStampFile(env)
	});
	const recovery = options.recovery ?? createServiceRecovery({ env });
	return new RestartController({
		...options,
		health,
		recovery
	});
}
//#endregion
//#region src/host/schemastery.ts
/**
* dsh-update-status — shadow-proof resolution of the platform's schemastery.
*
* `@deepseek-ai/schemastery` is a peer dependency: DSH ships it, and DSH's copy
* is the one carrying `volatile()` — the Loader's volatile-field projection this
* plugin's settings form is built on. A plain
* `import z from '@deepseek-ai/schemastery'` is resolved by Node's own directory
* walk *from the importing file*, so any copy sitting next to the plugin wins
* over the platform's copy. That is not hypothetical: an unmanaged tree left
* inside the install directory — a dev `node_modules` copied in by a
* local-directory install, which pnpm never removes — made `lib/index.js` throw
* `TypeError: …volatile is not a function` while it was being imported, so the
* whole host half disappeared before one line of plugin code ran.
*
* Nothing inside the plugin can repair that state: the failure precedes every
* plugin entry point. The resolution itself is made immune instead, trying
* platform copies before anything else:
*
* 1. the DSH installation running this process,
* 2. the profile peer farm DSH maintains (`$DSH_HOME/profiles/node_modules`),
* 3. the active profile's own tree,
* 4. whatever Node's walk finds next to this file — last resort.
*
* The first candidate that actually exposes `volatile()` wins, and the
* capability is verified rather than assumed. When no candidate provides it, the
* plugin still loads on the best copy it could load and reports exactly what it
* resolved: the missing capability becomes a `stale-schemastery` warning the
* panel renders instead of a dead plugin.
*/
const SCHEMASTERY_NAME = "@deepseek-ai/schemastery";
/** Anchor file name; it never has to exist, only to give `createRequire` a base. */
const PROBE_FILE = "dsh-update-status-peer-probe.cjs";
const MAX_ASCENT = 10;
function realPath(path) {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}
function boundedMessage$1(error) {
	const trimmed = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
	return trimmed === "" ? "unknown error" : trimmed.slice(0, 220);
}
function environmentDirectory(name) {
	const value = process.env[name];
	return typeof value === "string" && value.trim() !== "" ? value : null;
}
/** The DSH home directory, from the environment first and `~/.dsh` as a fallback. */
function dshHomeDirectory() {
	const configured = environmentDirectory("DSH_HOME");
	if (configured !== null) return configured;
	try {
		return join(homedir(), ".dsh");
	} catch {
		return null;
	}
}
/** The active profile directory, from `$DSH_PROFILE_DIR` or `$DSH_HOME/profiles/<profile>`. */
function profileDirectory() {
	const configured = environmentDirectory("DSH_PROFILE_DIR");
	if (configured !== null) return configured;
	const home = dshHomeDirectory();
	const profile = environmentDirectory("DSH_PROFILE");
	return home === null || profile === null ? null : join(home, "profiles", profile);
}
/**
* Anchor on the DSH package that owns the running entry point.
*
* The entry is the CLI file Node was started with, so ascending from it reaches
* the DSH installation whose `node_modules` holds the platform's schemastery.
* Reusing `manifestFromEntry` keeps this probe identical to the installation
* detection the status read already performs.
*/
function dshInstallAnchor() {
	const entry = process.argv[1];
	if (typeof entry !== "string" || entry === "") return null;
	const found = manifestFromEntry(entry);
	return found === void 0 || found.root === "" ? null : join(found.root, "package.json");
}
/** Candidate order: platform copies first, the shadowable walk last. */
function defaultSchemaCandidates() {
	const candidates = [];
	const install = dshInstallAnchor();
	if (install !== null) candidates.push({
		source: "dsh-install",
		anchor: install
	});
	const home = dshHomeDirectory();
	if (home !== null) candidates.push({
		source: "profile-peers",
		anchor: join(home, "profiles", PROBE_FILE)
	});
	const profile = profileDirectory();
	if (profile !== null) candidates.push({
		source: "profile-local",
		anchor: join(profile, PROBE_FILE)
	});
	candidates.push({
		source: "plugin-local",
		anchor: fileURLToPath(import.meta.url)
	});
	return candidates;
}
function manifestVersion(manifestPath) {
	try {
		const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (parsed.name !== "@deepseek-ai/schemastery" || typeof parsed.version !== "string") return null;
		const version = parsed.version.trim();
		return version === "" ? null : version;
	} catch {
		return null;
	}
}
/** Read the version of the schemastery package that owns a resolved entry path. */
function versionOfResolved(resolvedPath) {
	let directory = dirname(realPath(resolvedPath));
	for (let depth = 0; depth < MAX_ASCENT; depth += 1) {
		const manifestPath = join(directory, "package.json");
		if (existsSync(manifestPath)) {
			const version = manifestVersion(manifestPath);
			if (version !== null) return version;
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return null;
}
/** The nearest `node_modules` directory above a resolved package entry. */
function nodeModulesDirectoryOf(resolvedPath) {
	if (resolvedPath === null) return null;
	let directory = dirname(realPath(resolvedPath));
	for (let depth = 0; depth < MAX_ASCENT; depth += 1) {
		if (basename(directory) === "node_modules") return directory;
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return null;
}
/**
* Does this module expose the Loader's volatile projection?
*
* The probe builds a throwaway field because the capability is a prototype
* method, not a flag: 3.18.2 has no `volatile` at all, 3.18.4 (the copy DSH
* ships) does. Never throws — an unusable module is simply not a candidate.
*/
function supportsVolatile(factory) {
	if (factory === null || typeof factory !== "object" && typeof factory !== "function") return false;
	try {
		const boolean = factory.boolean;
		if (typeof boolean !== "function") return false;
		const field = boolean.call(factory);
		if (field === null || field === void 0 || typeof field.default !== "function") return false;
		const defined = field.default(true);
		return defined !== null && defined !== void 0 && typeof defined.volatile === "function";
	} catch {
		return false;
	}
}
/** Can this value build a schema? A wrapper object that cannot is never chosen. */
function isSchemaFactory(value) {
	if (value === null || typeof value !== "object" && typeof value !== "function") return false;
	const record = value;
	return typeof record.object === "function" && typeof record.boolean === "function" && typeof record.number === "function";
}
/**
* Pick the factory out of the shapes a CommonJS build can expose.
*
* The package assigns `module.exports` directly, but a bundler or an interop
* wrapper can put the same factory behind `default`. A shape that cannot build a
* schema is never chosen even as a fallback, because the degraded path still has
* to produce a `Config` — a wrapper object would throw while the entry loads,
* which is the failure this module exists to prevent.
*/
function factoryOf(loaded) {
	const shapes = [loaded, (loaded !== null && (typeof loaded === "object" || typeof loaded === "function") ? loaded : void 0)?.default].filter(isSchemaFactory);
	return shapes.find(supportsVolatile) ?? shapes[0];
}
function loadCandidate(candidate) {
	const report = {
		source: candidate.source,
		anchor: candidate.anchor,
		path: null,
		version: null,
		volatile: false,
		error: null
	};
	try {
		const require = createRequire(candidate.anchor);
		const resolved = require.resolve(SCHEMASTERY_NAME);
		const factory = factoryOf(require(resolved));
		if (factory === void 0) throw new Error("module does not export a schemastery factory");
		report.path = realPath(resolved);
		report.version = versionOfResolved(resolved);
		report.volatile = supportsVolatile(factory);
		return {
			report,
			factory
		};
	} catch (error) {
		report.error = boundedMessage$1(error);
		return {
			report,
			factory: void 0
		};
	}
}
/**
* Resolve schemastery once, preferring the copy that can actually do the job.
*
* Only a total miss throws, and only with the per-candidate reasons attached:
* that state means the plugin is not running inside a working DSH installation,
* so there is no schema system to build a settings form with. Every other
* outcome loads.
*/
function resolveSchemaRuntime(options = {}) {
	const candidates = options.candidates ?? defaultSchemaCandidates();
	const reports = [];
	let usable;
	let loaded;
	for (const candidate of candidates) {
		const attempt = loadCandidate(candidate);
		reports.push(attempt.report);
		if (attempt.factory === void 0) continue;
		loaded ??= attempt;
		if (attempt.report.volatile) {
			usable = attempt;
			break;
		}
	}
	const chosen = usable ?? loaded;
	if (chosen === void 0) {
		const tried = reports.map((report) => `${report.source}: ${report.error ?? "not loadable"}`).join("; ");
		throw new Error(`dsh-update-status could not resolve ${SCHEMASTERY_NAME} (${tried})`);
	}
	return {
		z: chosen.factory,
		volatile: chosen.report.volatile,
		source: chosen.report.source,
		path: chosen.report.path,
		version: chosen.report.version,
		candidates: reports,
		warning: chosen.report.volatile ? null : {
			code: "stale-schemastery",
			version: chosen.report.version,
			path: chosen.report.path ?? chosen.report.anchor,
			nodeModulesDir: nodeModulesDirectoryOf(chosen.report.path)
		}
	};
}
let resolved;
/**
* The process-wide resolution, computed on first use.
*
* The settings schema is built at module scope — the Loader reads the exported
* `Config` before `apply` runs — so the resolution cannot wait for a Host
* context. Every input here comes from the process environment or the filesystem.
*/
function schemaRuntime() {
	resolved ??= resolveSchemaRuntime();
	return resolved;
}
/** English, single-line summary of a resolution, for the Host log. */
function describeSchemaRuntime(runtime) {
	const where = runtime.path === null ? runtime.source : `${runtime.path} (${runtime.source})`;
	const version = runtime.version === null ? "" : `@${runtime.version}`;
	return `${SCHEMASTERY_NAME}${version} from ${where}; volatile preferences ${runtime.volatile ? "available" : "unavailable"}`;
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
/**
* Highest version in a list, preserving the spelling of the winner.
*
* Unparsable entries are skipped rather than failing the whole list: a registry
* that adds one odd tag must not hide the release line behind it. Returns
* undefined when nothing in the list is valid SemVer.
*/
function newestSemver(versions) {
	let winner;
	for (const candidate of versions) {
		if (parseSemver(candidate) === void 0) continue;
		if (winner === void 0 || compareSemver(candidate, winner) > 0) winner = candidate;
	}
	return winner;
}
//#endregion
//#region src/host/update-status.ts
const REGISTRY_URL = "https://registry.npmjs.org/@deepseek-ai%2Fdsh";
const DEFAULT_TTL_MS = 216e5;
const DEFAULT_TIMEOUT_MS = 15e3;
function boundedMessage(error) {
	const trimmed = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
	return trimmed === "" ? "unknown error" : trimmed.slice(0, 220);
}
/** English, single-line rendering of one warning; the Host log uses it directly. */
function describeWarning(warning) {
	switch (warning.code) {
		case "registry-unavailable": return `Unable to check the npm registry: ${warning.detail}`;
		case "version-incomparable": return `Unable to compare the current version ${warning.currentVersion} with the published version ${warning.latestVersion} using SemVer.`;
		case "version-unverified": return `Version ${warning.version} is newer than this plugin has been verified against.`;
		case "stale-schemastery": {
			const version = warning.version === null ? "" : ` ${warning.version}`;
			const remedy = warning.nodeModulesDir === null ? `Remove the stale ${SCHEMASTERY_NAME} directory there and restart DSH.` : `Remove the stale copy and restart DSH: rm -rf ${warning.nodeModulesDir}`;
			return `This plugin resolved ${SCHEMASTERY_NAME}${version} from ${warning.path} instead of the copy DSH provides, so preference fields cannot be marked volatile. ${remedy}`;
		}
	}
}
function warningFallback(warnings) {
	return warnings.length === 0 ? null : warnings.map(describeWarning).join(" ");
}
/**
* Advisory codes leave the chip alone; everything else is a failed read.
*
* `stale-schemastery` belongs here: the version answer is complete and usable,
* and only the settings form is degraded, so repainting the brand row would
* misreport a plugin-runtime fact as a failed update check.
*/
const ADVISORY_CODES = ["version-unverified", "stale-schemastery"];
function warningKindOf(warnings) {
	if (warnings.length === 0) return null;
	return warnings.every((warning) => ADVISORY_CODES.includes(warning.code)) ? "notice" : "failure";
}
function dateOrNull(value) {
	if (typeof value !== "string" || value === "") return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function compatibilityOf(version) {
	return VERIFIED_DSH_VERSIONS.includes(version) ? "verified" : "unverified";
}
/**
* Reduce one registry document to the single newest release.
*
* Every dist-tag contributes, not a fixed `latest`/`next`/`alpha` triple: npm
* tags are the registry's own vocabulary, and a version published under a tag
* this plugin has never heard of is still a version users can install.
*/
function registryReleaseOf(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("npm registry returned an invalid document");
	const record = value;
	const tags = record["dist-tags"];
	if (tags === null || typeof tags !== "object" || Array.isArray(tags)) throw new Error("npm registry response has no dist-tags");
	const version = newestSemver(Object.values(tags).filter((version) => typeof version === "string" && version.trim() !== "").map((version) => version.trim()));
	if (version === void 0) throw new Error("npm registry response has no comparable dist-tags");
	const time = record.time;
	return { latest: {
		version,
		publishedAt: dateOrNull((time !== null && typeof time === "object" && !Array.isArray(time) ? time : {})[version]),
		compatibility: compatibilityOf(version)
	} };
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
	runtimeWarnings;
	cache;
	inFlight;
	constructor(options) {
		this.installation = options.installation;
		this.fetchLatest = options.fetchLatest ?? createRegistryFetcher();
		this.now = options.now ?? Date.now;
		this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS));
		this.releaseUrl = options.releaseUrl ?? "https://github.com/deepseek-ai/deepseek-harness/releases";
		this.runtimeWarnings = options.runtimeWarnings ?? [];
	}
	getStatus(cacheTtlMinutes) {
		return this.check(false, cacheTtlMinutes);
	}
	/** `force` bypasses TTL but still joins any registry check already in flight. */
	async check(force = false, cacheTtlMinutes) {
		const ttlMs = isCacheTtlMinutes(cacheTtlMinutes) ? cacheTtlMinutes * 60 * 1e3 : this.ttlMs;
		const cached = this.cache;
		if (!force && cached !== void 0 && this.now() - cached.checkedAtMs < ttlMs) return this.statusFromCache(cached, true, []);
		if (this.inFlight !== void 0) try {
			return this.statusFromCache(await this.inFlight, false, []);
		} catch (error) {
			return this.statusAfterFailure(error);
		}
		const run = this.refreshRelease();
		this.inFlight = run;
		try {
			return this.statusFromCache(await run, false, []);
		} catch (error) {
			return this.statusAfterFailure(error);
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
	statusAfterFailure(error) {
		const warnings = [{
			code: "registry-unavailable",
			detail: boundedMessage(error)
		}];
		return this.cache === void 0 ? this.statusWithoutRemoteRelease(warnings) : this.statusFromCache(this.cache, true, warnings);
	}
	statusFromCache(cache, cached, initialWarnings) {
		const selected = cache.release.latest;
		const comparison = selected === null ? void 0 : compareSemver(this.installation.currentVersion, selected.version);
		const hasUpdate = comparison !== void 0 && comparison < 0;
		const warnings = [...initialWarnings];
		if (selected !== null && comparison === void 0) warnings.push({
			code: "version-incomparable",
			currentVersion: this.installation.currentVersion,
			latestVersion: selected.version
		});
		if (hasUpdate && selected !== null && selected.compatibility !== "verified") warnings.push({
			code: "version-unverified",
			version: selected.version
		});
		warnings.push(...this.runtimeWarnings);
		return {
			currentVersion: this.installation.currentVersion,
			latestVersion: selected?.version ?? null,
			hasUpdate,
			compatibility: selected?.compatibility ?? "unverified",
			cached,
			checkedAt: new Date(cache.checkedAtMs).toISOString(),
			warning: warningFallback(warnings),
			warningKind: warningKindOf(warnings),
			warnings,
			installKind: this.installation.installKind,
			upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || "@deepseek-ai/dsh", selected?.version ?? null),
			releaseUrl: this.releaseUrl,
			changelogUrl: this.releaseUrl,
			publishedAt: selected?.publishedAt ?? null,
			packageName: this.installation.packageName || "@deepseek-ai/dsh",
			canApplyInPlace: false
		};
	}
	statusWithoutRemoteRelease(warnings) {
		const combined = [...warnings, ...this.runtimeWarnings];
		return {
			currentVersion: this.installation.currentVersion,
			latestVersion: null,
			hasUpdate: false,
			compatibility: "unverified",
			cached: false,
			checkedAt: null,
			warning: warningFallback(combined),
			warningKind: warningKindOf(combined),
			warnings: combined,
			installKind: this.installation.installKind,
			upgradeCommand: upgradeCommandFor(this.installation.installKind, this.installation.packageName || "@deepseek-ai/dsh", null),
			releaseUrl: this.releaseUrl,
			changelogUrl: this.releaseUrl,
			publishedAt: null,
			packageName: this.installation.packageName || "@deepseek-ai/dsh",
			canApplyInPlace: false
		};
	}
};
//#endregion
//#region src/host/settings.ts
/**
* Build the Config schema from a resolved schemastery factory.
*
* `volatileAvailable` is the capability the resolver *verified*, not an
* assumption. On a copy without `volatile()` the three preferences stay ordinary
* fields — the plugin keeps loading and reports why through
* `schemaRuntime().warning` instead of throwing while its own entry is imported.
*
* @param factory - A schemastery factory, structurally the package's default export.
* @param volatileAvailable - Whether `factory` exposes the Loader's volatile projection.
*/
function buildConfigSchema(factory, volatileAvailable) {
	const volatile = (field) => {
		if (!volatileAvailable) return field;
		const method = field.volatile;
		return typeof method === "function" ? method.call(field) : field;
	};
	return factory.object({
		cacheTtlHours: factory.number().step(1).min(1).max(24).default(6),
		timeoutMs: factory.number().step(1).min(1e3).max(3e4).default(DEFAULT_TIMEOUT_MS),
		autoCheckOnMount: factory.boolean().default(true),
		sidebarEnabled: volatile(factory.boolean().default(true)),
		cacheTtlMinutes: volatile(factory.number().min(30).max(1440).default(360))
	});
}
const runtime = schemaRuntime();
/**
* The plugin's Config schema; its volatile fields ARE the settings form.
*
* The explicit two-argument annotation is load-bearing: a `.volatile()` field's
* output is a stable reference (`Volatile<T>`) rather than the bare value the
* input side takes, so the inferred schema type cannot be named by the emitted
* `.d.ts` (TS2883) without stating the input side here. The builder preserves
* that contract even on the degraded path, where no field is volatile.
*/
const Config = buildConfigSchema(runtime.z, runtime.volatile);
/**
* Suppress the auto-generated settings page for this entry.
*
* `autoGenerate` defaults to true, which would put a second, generic form beside
* the plugin's own `settings.section` page. Registering the policy is the
* documented move for a plugin that owns its preference UI (`ui-theme`,
* `ui-chat`, `ui-conversation` all do exactly this), and the entry's row stays
* in `settings.describe()` either way — the browser half still reads and writes
* it through `ctx.configForms`.
*
* Guarded twice: a deployment without the settings service never runs the inject
* callback (the plugin keeps working from its defaults), and a refused policy
* registration is contained instead of taking the plugin down.
*
* @param ctx - Host plugin context owning the entry's page policy.
*/
function installSettings(ctx) {
	try {
		ctx.inject(["settings"], (child) => {
			child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
		});
	} catch (error) {
		console.error("[dsh-update-status] settings page policy registration failed:", error);
	}
}
//#endregion
//#region src/index.ts
const name = "dsh-update-status";
/** Connection supplies the authenticated transport; settings remains optional. */
const inject = ["connection"];
function boundedNumber(value, fallback, min, max) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}
function apply(ctx, config = {}) {
	const ttlHours = boundedNumber(config.cacheTtlHours, 6, 1, 24);
	const timeoutMs = boundedNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1e3, 3e4);
	const schema = schemaRuntime();
	if (schema.warning !== null) console.warn(`[dsh-update-status] ${describeSchemaRuntime(schema)} — ${describeWarning(schema.warning)}`);
	const service = new UpdateStatusService({
		installation: detectInstallation(ctx),
		fetchLatest: createRegistryFetcher(timeoutMs),
		ttlMs: ttlHours * 60 * 60 * 1e3,
		runtimeWarnings: schema.warning === null ? [] : [schema.warning]
	});
	installSettings(ctx);
	const restart = createRestartController();
	const restartStatus = restart.status();
	recordBootOnce({
		pid: process.pid,
		instanceId: restartStatus.instanceId,
		supervisor: restartStatus.supervisor
	});
	installUpdateStatusRpc(ctx, service, restart);
	if (config.autoCheckOnMount !== false) service.getStatus();
}
//#endregion
export { Config, UpdateStatusService, apply, inject, name, resolveSchemaRuntime, schemaRuntime };
