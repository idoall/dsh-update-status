import { a as WINDOWS_TASK_NAME, c as parseSystemdMainPid, d as bootStampFile, f as countRecentRestarts, h as serviceLogDir, i as SYSTEMD_UNIT, l as parseWindowsTaskRunning, n as specFromArgs, s as parseLaunchdTrackedPid, t as planFor, u as RESTART_STORM_WINDOW_MS } from "./plan-BornHBEZ.js";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
async function observeServiceState(spec, run, uid) {
	if (spec.platform === "darwin") {
		const result = run("launchctl", ["print", `gui/${String(uid)}/${spec.label}`]);
		const pid = parseLaunchdTrackedPid(result.stdout);
		return pid === void 0 ? { running: false } : {
			running: true,
			pid
		};
	}
	if (spec.platform === "linux") {
		const result = run("systemctl", [
			"--user",
			"show",
			SYSTEMD_UNIT,
			"-p",
			"MainPID",
			"--value"
		]);
		const pid = parseSystemdMainPid(result.stdout);
		return pid === void 0 ? { running: false } : {
			running: true,
			pid
		};
	}
	const result = run("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		`(Get-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}').State`
	]);
	return { running: parseWindowsTaskRunning(result.stdout) };
}
function defaultSleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
async function verifyActivatedService(spec, options) {
	const attempts = options.attempts ?? 4;
	const intervalMs = options.intervalMs ?? 5e3;
	const sleep = options.sleep ?? defaultSleep;
	const uid = options.uid ?? 0;
	const recentRestarts = options.recentRestarts ?? (() => countRecentRestarts(serviceLogDir(), bootStampFile(), Date.now(), 18e4));
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const restarts = recentRestarts();
		if (restarts >= 4) return {
			kind: "crash-loop",
			recentRestarts: restarts,
			windowMs: RESTART_STORM_WINDOW_MS
		};
		if ((await observeServiceState(spec, options.run, uid)).running) {
			if (attempt === attempts - 1) return { kind: "settled" };
			await sleep(intervalMs);
			continue;
		}
		if (attempt === attempts - 1) return { kind: "not-running" };
		await sleep(intervalMs);
	}
	return { kind: "not-running" };
}
//#endregion
//#region src/service/cli.ts
/** Explicit, cross-platform user-service installer CLI. Never runs at plugin mount. */
const RECEIPT_VERSION = 1;
function environment() {
	return {
		platform: process.platform,
		home: process.env.HOME ?? process.env.USERPROFILE ?? "",
		cwd: process.cwd(),
		execPath: process.execPath,
		env: process.env,
		path: process.env.PATH,
		...typeof process.getuid === "function" ? { uid: process.getuid() } : {}
	};
}
function runner(file, args) {
	const result = spawnSync(file, [...args], {
		encoding: "utf8",
		windowsHide: true
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		...result.error === void 0 ? {} : { error: result.error.message }
	};
}
function usage() {
	return `Usage: dsh-update-status-service <plan|install|activate|status|stop|uninstall> [options]

Create a current-user DSH Web supervisor. This CLI never runs automatically.

Options:
  --dry-run              Print the expanded plan without writing or invoking OS services
  --profile <name>       DSH profile (default: DSH_PROFILE or web)
  --workspace <path>     Required absolute working directory for DSH
  --dsh-home <path>      Optional absolute DSH home (default: DSH_HOME or ~/.dsh)
  --host <127.0.0.1|0.0.0.0>  Bind host (default: 127.0.0.1)
  --port <1..65535>      Web port (default: 3080)
  --node <path>          Absolute Node executable (default: current Node)
  --dsh <path>           Absolute dsh executable (default: resolve from PATH)
  --log-dir <path>       Absolute log directory (default: $DSH_HOME/logs)

Workflow: plan --dry-run → install → stop the terminal-started DSH yourself → activate.

activate refuses an occupied port, never kills a process, and then verifies that
the service it started actually took over; a service that begins crash-looping
makes activate fail instead of reporting success.
`;
}
function assertSafeText(value, description) {
	if (/[\u0000\r\n]/.test(value)) throw new Error(`${description} must not contain NUL or line breaks`);
}
function assertReadableRegular(path, description) {
	assertSafeText(path, description);
	if (!existsSync(path)) throw new Error(`${description} does not exist: ${path}`);
	try {
		if (!statSync(path).isFile()) throw new Error(`${description} is not a regular file: ${path}`);
		accessSync(path, constants.R_OK);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(description)) throw error;
		throw new Error(`${description} is not readable: ${path}`);
	}
}
function assertExecutable(path, description) {
	assertReadableRegular(path, description);
	if (process.platform !== "win32") try {
		accessSync(path, constants.X_OK);
	} catch {
		throw new Error(`${description} is not executable: ${path}`);
	}
}
function validateSpec(spec) {
	for (const [description, value] of [
		["profile", spec.profile],
		["workspace", spec.workspace],
		["home", spec.home],
		["log directory", spec.logDir],
		["host", spec.host]
	]) assertSafeText(value, description);
	if (spec.host !== "127.0.0.1" && spec.host !== "0.0.0.0") throw new Error("`--host` must be 127.0.0.1 or 0.0.0.0");
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.profile)) throw new Error("`--profile` must contain only letters, numbers, dot, underscore, or hyphen");
	assertExecutable(spec.nodePath, "Node executable");
	assertReadableRegular(spec.dshPath, "dsh executable");
	assertSafeText(spec.workspace, "workspace");
	if (!existsSync(spec.workspace) || !statSync(spec.workspace).isDirectory()) throw new Error(`workspace is not a directory: ${spec.workspace}`);
}
function atomicWrite(path, content) {
	mkdirSync(dirname(path), {
		recursive: true,
		mode: 448
	});
	const temporary = `${path}.${String(process.pid)}.tmp`;
	writeFileSync(temporary, content, {
		encoding: "utf8",
		mode: 384
	});
	renameSync(temporary, path);
}
/**
* Replace an artifact only when we can prove we wrote it: either it already holds
* exactly what we are about to write, or our own receipt names that path. The
* receipt is what makes an upgrade possible at all — an improved definition
* differs from the stored one by exactly the fix being installed, so
* byte-equality with the previous rendering can never authorise it.
*/
function ensureReplaceable(path, expected, managed) {
	if (!existsSync(path)) return;
	let current;
	try {
		current = readFileSync(path, "utf8");
	} catch {
		throw new Error(`refusing to replace unreadable existing file: ${path}`);
	}
	if (current === expected || managed) return;
	throw new Error(`refusing to overwrite an existing unmanaged service artifact: ${path}`);
}
function receiptOwnsPath(previous, path) {
	if (previous === void 0) return false;
	return previous.paths.definitionFile === path || previous.paths.stateFile === path || previous.paths.wrapperFile === path;
}
function receiptTextOf(receipt) {
	return JSON.stringify(receipt, null, 2) + "\n";
}
function readReceiptIfPresent(path) {
	return existsSync(path) ? readReceipt(path) : void 0;
}
function readReceipt(path) {
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		if (value.version !== RECEIPT_VERSION || value.managedBy !== "dsh-update-status" || value.spec === void 0 || value.paths === void 0) throw new Error("not a dsh-update-status service receipt");
		return value;
	} catch (error) {
		throw new Error(`cannot read managed service receipt ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
async function portIsFree(host, port) {
	return await new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen(port, host, () => server.close((error) => resolve(error === void 0)));
	});
}
function serialisePlan(plan) {
	return JSON.stringify({
		platform: plan.spec.platform,
		label: plan.spec.label,
		nodePath: plan.spec.nodePath,
		dshPath: plan.spec.dshPath,
		profile: plan.spec.profile,
		workspace: plan.spec.workspace,
		host: plan.spec.host,
		port: plan.spec.port,
		definitionFile: plan.paths.definitionFile,
		wrapperFile: plan.paths.wrapperFile,
		stateFile: plan.paths.stateFile,
		logs: {
			stdout: plan.paths.stdoutFile,
			stderr: plan.paths.stderrFile
		},
		commands: {
			install: plan.installCommand,
			start: plan.startCommand,
			status: plan.statusCommand,
			stop: plan.stopCommand,
			uninstall: plan.uninstallCommand,
			recover: plan.recoverCommand
		}
	}, null, 2) + "\n";
}
function commandsForActivate(plan, uid) {
	if (plan.spec.platform === "darwin") return [[
		"launchctl",
		"bootstrap",
		`gui/${uid}`,
		plan.paths.definitionFile
	]];
	if (plan.spec.platform === "linux") return [[
		"systemctl",
		"--user",
		"daemon-reload"
	], [
		"systemctl",
		"--user",
		"enable",
		"--now",
		"dsh-update-status-web.service"
	]];
	return [[
		"schtasks.exe",
		"/Create",
		"/TN",
		"DSH Update Status Web",
		"/XML",
		plan.paths.definitionFile,
		"/F"
	], [
		"schtasks.exe",
		"/Run",
		"/TN",
		"DSH Update Status Web"
	]];
}
function invoke(command, run) {
	const [file, ...args] = command;
	if (file === void 0) throw new Error("empty service command");
	const result = run(file, args);
	if (result.status !== 0) throw new Error(`${command.join(" ")} failed (${String(result.status)}): ${(result.stderr || result.stdout || result.error || "no diagnostic").trim()}`);
}
function preflight(spec) {
	const result = spawnSync(spec.nodePath, [
		spec.dshPath,
		"--profile",
		spec.profile,
		"--dump-config"
	], {
		cwd: spec.workspace,
		encoding: "utf8",
		timeout: 9e4,
		windowsHide: true,
		env: {
			HOME: spec.home,
			...spec.dshHome === void 0 ? {} : { DSH_HOME: spec.dshHome },
			PATH: `${dirname(spec.nodePath)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`
		}
	});
	if (result.status !== 0) {
		const diagnostic = (result.stderr || result.stdout || result.error?.message || "no diagnostic").trim().slice(0, 800);
		throw new Error(`DSH boot-free preflight failed; no service definition was written: ${diagnostic}`);
	}
}
async function main(argv = process.argv.slice(2), env = environment(), run = runner, hooks = {}) {
	const [action, ...rawArgs] = argv;
	if (action === void 0 || action === "--help" || action === "-h") {
		process.stdout.write(usage());
		return action === void 0 ? 2 : 0;
	}
	if (![
		"plan",
		"install",
		"activate",
		"status",
		"stop",
		"uninstall"
	].includes(action)) {
		process.stderr.write(`Unknown command: ${action}\n${usage()}`);
		return 2;
	}
	const dryRun = rawArgs.includes("--dry-run") || action === "plan";
	const args = rawArgs.filter((value) => value !== "--dry-run");
	try {
		const spec = specFromArgs(args, env);
		validateSpec(spec);
		const plan = planFor(spec, env.uid ?? 0);
		if (dryRun) {
			process.stdout.write(serialisePlan(plan));
			return 0;
		}
		if (action === "install") {
			(hooks.preflight ?? preflight)(spec);
			const previous = readReceiptIfPresent(plan.paths.stateFile);
			ensureReplaceable(plan.paths.definitionFile, plan.definition, receiptOwnsPath(previous, plan.paths.definitionFile));
			if (plan.wrapper !== void 0 && plan.paths.wrapperFile !== void 0) ensureReplaceable(plan.paths.wrapperFile, plan.wrapper, receiptOwnsPath(previous, plan.paths.wrapperFile));
			const receiptText = receiptTextOf({
				version: RECEIPT_VERSION,
				managedBy: "dsh-update-status",
				spec,
				paths: plan.paths
			});
			ensureReplaceable(plan.paths.stateFile, receiptText, receiptOwnsPath(previous, plan.paths.stateFile));
			mkdirSync(spec.logDir, {
				recursive: true,
				mode: 448
			});
			atomicWrite(plan.paths.definitionFile, plan.definition);
			if (plan.wrapper !== void 0 && plan.paths.wrapperFile !== void 0) atomicWrite(plan.paths.wrapperFile, plan.wrapper);
			atomicWrite(plan.paths.stateFile, receiptText);
			process.stdout.write(`Staged user service definition: ${plan.paths.definitionFile}\nNo service has started. Stop your terminal-started DSH, then run activate.\n`);
			return 0;
		}
		const receipt = readReceipt(plan.paths.stateFile);
		if (action === "activate") {
			if (!await portIsFree(receipt.spec.host, receipt.spec.port)) throw new Error(`port ${receipt.spec.host}:${String(receipt.spec.port)} is in use; stop the existing DSH yourself before activate. Nothing was killed.`);
			for (const command of commandsForActivate(plan, env.uid ?? 0)) invoke(command, run);
			const verification = await (hooks.verify ?? ((installed) => verifyActivatedService(installed, {
				run,
				uid: env.uid ?? 0
			})))(receipt.spec);
			if (verification.kind === "crash-loop") throw new Error(`the activated service is restarting repeatedly (${String(verification.recentRestarts)} starts within ${String(Math.round(verification.windowMs / 1e3))}s); another process probably holds ${receipt.spec.host}:${String(receipt.spec.port)}. Nothing was killed. Stop that instance, fix the cause, then run activate again.`);
			if (verification.kind === "not-running") throw new Error(`the activated service reported no running process; check the native status and the logs in ${receipt.spec.logDir}. Nothing was killed.`);
			process.stdout.write("User service activated and verified to be running. Wait for DSH to become ready, then open the existing Web URL.\n");
			return 0;
		}
		if (action === "status") {
			const result = run(plan.statusCommand[0], plan.statusCommand.slice(1));
			process.stdout.write(serialisePlan(plan));
			process.stdout.write(`Native status (${plan.statusCommand.join(" ")}):\n${result.stdout || result.stderr || result.error || `exit ${String(result.status)}`}\n`);
			return result.status === 0 ? 0 : 1;
		}
		if (action === "stop") {
			invoke(plan.stopCommand, run);
			process.stdout.write("User service stopped. Its definition and receipt remain; run activate to start it again.\n");
			return 0;
		}
		const result = run(plan.uninstallCommand[0], plan.uninstallCommand.slice(1));
		if (result.status !== 0) process.stderr.write(`Warning: ${result.stderr || result.stdout || "service was not loaded"}\n`);
		rmSync(receipt.paths.definitionFile, { force: true });
		if (receipt.paths.wrapperFile !== void 0) rmSync(receipt.paths.wrapperFile, { force: true });
		rmSync(receipt.paths.stateFile, { force: true });
		process.stdout.write("Removed the managed user-service definition. Logs were preserved.\n");
		return 0;
	} catch (error) {
		process.stderr.write(`dsh-update-status-service: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}
if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) main().then((code) => {
	process.exitCode = code;
});
//#endregion
export { main };
