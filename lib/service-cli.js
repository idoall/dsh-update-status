import { createRequire } from "node:module";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
//#region src/service/plan.ts
/** Build transparent per-OS user-service definitions; do not install them here. */
const SERVICE_LABEL = "com.idoall.dsh-update-status.web";
const SUPERVISOR_MARKER = "dsh-update-status";
function xml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function systemd(value) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
function powerShell(value) {
	return value.replace(/'/g, "''");
}
function boundedPort(value) {
	const port = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("`--port` must be an integer from 1 to 65535");
	return port;
}
function valueAfter(args, flag) {
	const index = args.indexOf(flag);
	if (index < 0) return void 0;
	const value = args[index + 1];
	if (value === void 0 || value.startsWith("--")) throw new Error(`missing value after ${flag}`);
	return value;
}
/**
* Resolve the real JS file behind `@deepseek-ai/dsh`'s `bin.dsh`, using the
* selected profile as a Node resolution anchor. This avoids platform shell
* shims (`dsh.cmd`) and keeps every native service on `node <absolute-js>`.
*/
function dshPathOf(env, profile, dshHome, override) {
	const fromArg = override?.trim();
	if (fromArg !== void 0 && fromArg !== "") return isAbsolute(fromArg) ? fromArg : resolve(env.cwd, fromArg);
	const home = dshHome ?? join(env.home || homedir(), ".dsh");
	try {
		const anchor = join(home, "profiles", profile, "dsh-update-status-service-resolver.cjs");
		const manifestPath = createRequire(anchor).resolve("@deepseek-ai/dsh/package.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (manifest.name !== "@deepseek-ai/dsh" || typeof manifest.bin?.dsh !== "string") throw new Error("invalid dsh package manifest");
		return realpathSync(join(dirname(manifestPath), manifest.bin.dsh));
	} catch (error) {
		throw new Error(`cannot resolve @deepseek-ai/dsh from profile ${profile}; rerun with --dsh /absolute/path/to/lib/bin.js (${error instanceof Error ? error.message : String(error)})`);
	}
}
function servicePlatform(value) {
	if (value === "darwin" || value === "linux" || value === "win32") return value;
	throw new Error(`unsupported platform: ${value}; supported: macOS, Linux, Windows`);
}
function specFromArgs(args, env) {
	const platform = servicePlatform(env.platform);
	const profile = valueAfter(args, "--profile") ?? env.env.DSH_PROFILE ?? "web";
	const workspace = valueAfter(args, "--workspace");
	if (workspace === void 0) throw new Error("`--workspace` is required and must be the absolute directory DSH should use");
	const host = valueAfter(args, "--host") ?? "127.0.0.1";
	const port = boundedPort(valueAfter(args, "--port") ?? 3080);
	const home = env.home || homedir();
	const dshHome = valueAfter(args, "--dsh-home") ?? (env.env.DSH_HOME?.trim() || void 0);
	if (dshHome !== void 0 && !isAbsolute(dshHome)) throw new Error("`--dsh-home` must be an absolute path");
	const logDir = valueAfter(args, "--log-dir") ?? join(dshHome ?? join(home, ".dsh"), "logs");
	const dshPath = dshPathOf(env, profile, dshHome, valueAfter(args, "--dsh"));
	const nodePath = valueAfter(args, "--node") ?? env.execPath;
	if (!isAbsolute(nodePath)) throw new Error("`--node` must be an absolute executable path");
	if (!isAbsolute(dshPath)) throw new Error("`--dsh` must be an absolute executable path");
	if (!isAbsolute(workspace)) throw new Error("`--workspace` must be an absolute path");
	if (!isAbsolute(logDir)) throw new Error("`--log-dir` must be an absolute path");
	return {
		schemaVersion: 1,
		platform,
		label: SERVICE_LABEL,
		nodePath,
		dshPath,
		profile,
		workspace,
		host,
		port,
		home,
		...dshHome === void 0 ? {} : { dshHome },
		logDir,
		supervisorMarker: SUPERVISOR_MARKER
	};
}
function pathsFor(spec) {
	const root = spec.dshHome ?? join(spec.home, ".dsh");
	const stdoutFile = join(spec.logDir, "dsh-web-service.stdout.log");
	const stderrFile = join(spec.logDir, "dsh-web-service.stderr.log");
	if (spec.platform === "darwin") return {
		stateFile: join(root, "dsh-update-status-service.json"),
		definitionFile: join(spec.home, "Library", "LaunchAgents", `${spec.label}.plist`),
		stdoutFile,
		stderrFile
	};
	if (spec.platform === "linux") return {
		stateFile: join(root, "dsh-update-status-service.json"),
		definitionFile: join(spec.home, ".config", "systemd", "user", "dsh-update-status-web.service"),
		stdoutFile,
		stderrFile
	};
	const base = envLocalAppData(spec);
	return {
		stateFile: join(root, "dsh-update-status-service.json"),
		definitionFile: join(base, "dsh-update-status", "dsh-web-task.xml"),
		wrapperFile: join(base, "dsh-update-status", "dsh-web-supervisor.ps1"),
		stdoutFile,
		stderrFile
	};
}
function envLocalAppData(spec) {
	return join(spec.home, "AppData", "Local");
}
function webArguments(spec) {
	return [
		spec.dshPath,
		"--profile",
		spec.profile,
		"--host",
		spec.host,
		"--port",
		String(spec.port),
		"--no-open"
	];
}
function launchdDefinition(spec, paths) {
	const args = [spec.nodePath, ...webArguments(spec)].map((value) => `    <string>${xml(value)}</string>`).join("\n");
	const envXml = [
		["HOME", spec.home],
		["PATH", `${dirname(spec.nodePath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`],
		["DSH_WEB_SUPERVISOR", spec.supervisorMarker],
		...spec.dshHome === void 0 ? [] : [["DSH_HOME", spec.dshHome]]
	].map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(spec.workspace)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(paths.stdoutFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(paths.stderrFile)}</string>
</dict>
</plist>
`;
}
function systemdDefinition(spec) {
	const command = [spec.nodePath, ...webArguments(spec)].map((value) => `"${systemd(value)}"`).join(" ");
	const env = [
		`Environment="HOME=${systemd(spec.home)}"`,
		`Environment="PATH=${systemd(`${dirname(spec.nodePath)}:/usr/local/bin:/usr/bin:/bin`)}"`,
		`Environment="DSH_WEB_SUPERVISOR=${spec.supervisorMarker}"`,
		...spec.dshHome === void 0 ? [] : [`Environment="DSH_HOME=${systemd(spec.dshHome)}"`]
	].join("\n");
	return `[Unit]
Description=DSH Web managed by dsh-update-status
After=network-online.target

[Service]
Type=simple
WorkingDirectory="${systemd(spec.workspace)}"
${env}
ExecStart=${command}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}
function windowsWrapper(spec, paths) {
	const node = powerShell(spec.nodePath);
	const dsh = powerShell(spec.dshPath);
	const workspace = powerShell(spec.workspace);
	const out = powerShell(paths.stdoutFile);
	const err = powerShell(paths.stderrFile);
	const home = powerShell(spec.home);
	const dshHome = spec.dshHome === void 0 ? "" : `$env:DSH_HOME = '${powerShell(spec.dshHome)}'\n`;
	return `$ErrorActionPreference = 'Stop'
$env:HOME = '${home}'
$env:DSH_WEB_SUPERVISOR = '${spec.supervisorMarker}'
${dshHome}Set-Location -LiteralPath '${workspace}'
while ($true) {
  & '${node}' '${dsh}' --profile '${powerShell(spec.profile)}' --host '${powerShell(spec.host)}' --port '${String(spec.port)}' --no-open 1>> '${out}' 2>> '${err}'
  $exitCode = $LASTEXITCODE
  Start-Sleep -Seconds 3
  # The user service owns deliberate restarts (exit 42) and unexpected exits.
  # Manual uninstall stops the scheduled task, which ends this wrapper.
}
`;
}
function windowsDefinition(spec, paths) {
	const wrapper = paths.wrapperFile;
	if (wrapper === void 0) throw new Error("Windows service plan requires a wrapper path");
	return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>DSH Web managed by dsh-update-status</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -ExecutionPolicy Bypass -File &quot;${xml(wrapper)}&quot;</Arguments></Exec></Actions>
</Task>
`;
}
/** Generate a service plan without writing, starting, or stopping anything. */
function planFor(spec, uid = 0) {
	const paths = pathsFor(spec);
	if (spec.platform === "darwin") {
		const domain = `gui/${uid}`;
		return {
			spec,
			paths,
			definition: launchdDefinition(spec, paths),
			installCommand: [
				"launchctl",
				"bootstrap",
				domain,
				paths.definitionFile
			],
			startCommand: [
				"launchctl",
				"kickstart",
				"-k",
				`${domain}/${spec.label}`
			],
			statusCommand: [
				"launchctl",
				"print",
				`${domain}/${spec.label}`
			],
			stopCommand: [
				"launchctl",
				"bootout",
				`${domain}/${spec.label}`
			],
			uninstallCommand: [
				"launchctl",
				"bootout",
				`${domain}/${spec.label}`
			]
		};
	}
	if (spec.platform === "linux") return {
		spec,
		paths,
		definition: systemdDefinition(spec),
		installCommand: [
			"systemctl",
			"--user",
			"daemon-reload"
		],
		startCommand: [
			"systemctl",
			"--user",
			"enable",
			"--now",
			"dsh-update-status-web.service"
		],
		statusCommand: [
			"systemctl",
			"--user",
			"status",
			"dsh-update-status-web.service"
		],
		stopCommand: [
			"systemctl",
			"--user",
			"disable",
			"--now",
			"dsh-update-status-web.service"
		],
		uninstallCommand: [
			"systemctl",
			"--user",
			"disable",
			"--now",
			"dsh-update-status-web.service"
		]
	};
	return {
		spec,
		paths,
		definition: windowsDefinition(spec, paths),
		wrapper: windowsWrapper(spec, paths),
		installCommand: [
			"schtasks.exe",
			"/Create",
			"/TN",
			"DSH Update Status Web",
			"/XML",
			paths.definitionFile,
			"/F"
		],
		startCommand: [
			"schtasks.exe",
			"/Run",
			"/TN",
			"DSH Update Status Web"
		],
		statusCommand: [
			"schtasks.exe",
			"/Query",
			"/TN",
			"DSH Update Status Web",
			"/V",
			"/FO",
			"LIST"
		],
		stopCommand: [
			"schtasks.exe",
			"/End",
			"/TN",
			"DSH Update Status Web"
		],
		uninstallCommand: [
			"schtasks.exe",
			"/Delete",
			"/TN",
			"DSH Update Status Web",
			"/F"
		]
	};
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
function ensureManagedTarget(path, expected) {
	if (!existsSync(path)) return;
	let current;
	try {
		current = readFileSync(path, "utf8");
	} catch {
		throw new Error(`refusing to replace unreadable existing file: ${path}`);
	}
	if (current !== expected) throw new Error(`refusing to overwrite an existing unmanaged service artifact: ${path}`);
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
			uninstall: plan.uninstallCommand
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
			ensureManagedTarget(plan.paths.definitionFile, plan.definition);
			if (plan.wrapper !== void 0 && plan.paths.wrapperFile !== void 0) ensureManagedTarget(plan.paths.wrapperFile, plan.wrapper);
			const receipt = {
				version: RECEIPT_VERSION,
				managedBy: "dsh-update-status",
				spec,
				paths: plan.paths
			};
			const receiptText = JSON.stringify(receipt, null, 2) + "\n";
			ensureManagedTarget(plan.paths.stateFile, receiptText);
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
			process.stdout.write("User service activated. Wait for DSH to become ready, then open the existing Web URL.\n");
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
