import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
//#region src/shared/restart-evidence.ts
/**
* First-party evidence that a DSH Web Host is being restarted in a storm.
*
* A restart is only safe when the supervisor's next start can actually bind the
* port. When a second launcher owns the port (another plugin's restart helper, a
* `nohup` script), the supervisor keeps respawning a process that dies with
* `EADDRINUSE` every few seconds — forever, because `KeepAlive`/`Restart=` has no
* failure ceiling of its own. Two files make that visible to whichever process
* is still alive:
*
* - one boot stamp appended by every Host generation that reaches this plugin;
* - DSH's own `startup-*.log` diagnostics, written by every process that fails
*   to boot (a failing generation never composes this plugin, so it cannot leave
*   a stamp of its own).
*
* Counting both is deliberate: stamps catch a loop of *successful* short-lived
* boots, diagnostics catch a loop of *failed* ones. Neither is a security
* boundary — they exist to stop a destructive restart button from lying.
*/
const BOOT_STAMP_FILE = "dsh-update-status-boots.log";
/** A window this short can only fill up when starts are failing back to back. */
const RESTART_STORM_WINDOW_MS = 18e4;
/** DSH's own per-process failure diagnostics, written into the same log dir. */
const STARTUP_DIAGNOSTIC = /^startup-.*\.log$/;
const BOOT_STAMP_MAX_BYTES = 32768;
function dshHomeOf(env = process.env) {
	const configured = env.DSH_HOME?.trim();
	if (configured !== void 0 && configured !== "") return configured;
	const home = env.HOME?.trim();
	return join(home !== void 0 && home !== "" ? home : homedir(), ".dsh");
}
function serviceLogDir(env = process.env) {
	return join(dshHomeOf(env), "logs");
}
function bootStampFile(env = process.env) {
	return join(serviceLogDir(env), BOOT_STAMP_FILE);
}
/**
* Append one line, best effort. A Host must never fail to start because its own
* restart evidence could not be written, so every filesystem error is swallowed.
*/
function recordBootStamp(path, stamp) {
	try {
		mkdirSync(dirname(path), {
			recursive: true,
			mode: 448
		});
		trimBootStamps(path);
		appendFileSync(path, `${JSON.stringify({
			at: stamp.at ?? Date.now(),
			pid: stamp.pid,
			instanceId: stamp.instanceId,
			supervisor: stamp.supervisor
		})}\n`, {
			encoding: "utf8",
			mode: 384
		});
	} catch {}
}
function trimBootStamps(path) {
	if (!existsSync(path) || statSync(path).size <= BOOT_STAMP_MAX_BYTES) return;
	const kept = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").slice(-100);
	writeFileSync(path, kept.length === 0 ? "" : `${kept.join("\n")}\n`, {
		encoding: "utf8",
		mode: 384
	});
}
function readBootStamps(path) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return [];
	}
	const stamps = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const value = JSON.parse(line);
			if (typeof value.at !== "number" || typeof value.pid !== "number" || typeof value.instanceId !== "string") continue;
			stamps.push({
				at: value.at,
				pid: value.pid,
				instanceId: value.instanceId,
				supervisor: typeof value.supervisor === "string" ? value.supervisor : null
			});
		} catch {}
	}
	return stamps;
}
function countRecentBootStamps(stamps, now, windowMs) {
	let count = 0;
	for (const stamp of stamps) {
		const age = now - stamp.at;
		if (age >= -1e3 && age <= windowMs) count += 1;
	}
	return count;
}
/** DSH writes one `startup-*.log` per process that failed to boot. */
function countRecentStartupFailures(logDir, now, windowMs) {
	let names;
	try {
		names = readdirSync(logDir);
	} catch {
		return 0;
	}
	let count = 0;
	for (const name of names) {
		if (!STARTUP_DIAGNOSTIC.test(name)) continue;
		try {
			const age = now - statSync(join(logDir, name)).mtimeMs;
			if (age >= -1e3 && age <= windowMs) count += 1;
		} catch {}
	}
	return count;
}
/**
* Both halves of the storm signal, for callers that only have the paths — the
* Host's health probe and the service CLI's post-activation check share it.
*/
function countRecentRestarts(logDir, bootLog, now, windowMs = RESTART_STORM_WINDOW_MS) {
	return countRecentBootStamps(readBootStamps(bootLog), now, windowMs) + countRecentStartupFailures(logDir, now, windowMs);
}
//#endregion
//#region src/shared/service-platform.ts
/**
* How each platform reports the state of the user service this plugin stages.
*
* Shared between the Host's ownership probe and the CLI's post-activation check
* so both read the same output with the same rules; the strings are the only
* stable interface those commands offer.
*/
/**
* The launchd job this plugin stages. It is a fixed constant rather than something
* read back from the environment: the job environment launchd configures does
* carry `XPC_SERVICE_NAME=<label>`, but that value does not survive to the DSH
* process behind the staged `/bin/sh` wrapper — the Host reads `XPC_SERVICE_NAME=0`
* — so ownership must be asked of launchd by label.
*/
const LAUNCHD_LABEL = "com.idoall.dsh-update-status.web";
const SYSTEMD_UNIT = "dsh-update-status-web.service";
const WINDOWS_TASK_NAME = "DSH Update Status Web";
const WINDOWS_WRAPPER_BASENAME = "dsh-web-supervisor.ps1";
/** The first `pid = N` of `launchctl print` output is the job's tracked process. */
function parseLaunchdTrackedPid(output) {
	const match = /(?:^|\n)[^\S\n]*pid = (\d+)/.exec(output);
	if (match?.[1] === void 0) return void 0;
	const pid = Number(match[1]);
	return Number.isInteger(pid) && pid > 0 ? pid : void 0;
}
/** `systemctl --user show -p MainPID --value` prints the pid alone, or `0`. */
function parseSystemdMainPid(output) {
	const value = output.trim().split("\n")[0]?.trim() ?? "";
	if (!/^\d+$/.test(value)) return void 0;
	const pid = Number(value);
	return pid > 0 ? pid : void 0;
}
/** `(Get-ScheduledTask -TaskName ...).State` names its state in English. */
function parseWindowsTaskRunning(output) {
	return /(?:^|\W)running(?:\W|$)/i.test(output);
}
//#endregion
//#region src/service/plan.ts
/** Build transparent per-OS user-service definitions; do not install them here. */
const SERVICE_LABEL = LAUNCHD_LABEL;
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
function shQuote(value) {
	return `'${value.replace(/'/g, "'\\''")}'`;
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
		wrapperFile: join(root, "dsh-update-status", "dsh-web-supervisor.sh"),
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
function launchdWrapper(spec, paths, uid) {
	const args = [spec.nodePath, ...webArguments(spec)].map(shQuote).join(" ");
	const kickstart = `launchctl kickstart -k gui/${String(uid)}/${spec.label}`;
	return `#!/bin/sh
# Managed by dsh-update-status. This wrapper, not launchd, owns the restart loop.
#
# KeepAlive alone respawns forever and has no failure ceiling: as soon as another
# launcher owns the port, every respawn dies with EADDRINUSE in a couple of
# seconds and the machine spins. The loop therefore lives here, where it can stop.
#
#   * RAPID_FAILURE_WINDOW: a child that dies this fast never finished a boot.
#   * RAPID_FAILURE_LIMIT: that many in a row stops the loop and says why on
#     stderr (launchd captures it in the service log).
#   * a child that ran longer resets the counter, so ordinary page restarts and
#     long uptimes never trip it.
#
# Recover with: ${kickstart}
set -u
RAPID_FAILURE_WINDOW=${String(30)}
RAPID_FAILURE_LIMIT=${String(5)}
RESTART_DELAY=${String(3)}
child=0
forward() {
  if [ "$child" -gt 0 ]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap forward TERM INT HUP
rapid=0
while :; do
  started=$(date +%s)
  ${args} &
  child=$!
  wait "$child"
  code=$?
  child=0
  elapsed=$(( $(date +%s) - started ))
  if [ "$elapsed" -lt "$RAPID_FAILURE_WINDOW" ]; then
    rapid=$(( rapid + 1 ))
    echo "[dsh-update-status] supervisor: DSH exited with code $code after \${elapsed}s (rapid failure $rapid/$RAPID_FAILURE_LIMIT)" >&2
  else
    rapid=0
  fi
  if [ "$rapid" -ge "$RAPID_FAILURE_LIMIT" ]; then
    echo "[dsh-update-status] supervisor: giving up after $RAPID_FAILURE_LIMIT rapid failures (last exit code $code). Another process may hold the port; fix that, then run: ${kickstart}" >&2
    exit 78
  fi
  sleep "$RESTART_DELAY"
done
`;
}
function launchdDefinition(spec, paths) {
	const wrapper = paths.wrapperFile;
	if (wrapper === void 0) throw new Error("macOS service plan requires a supervisor wrapper path");
	const args = ["/bin/sh", wrapper].map((value) => `    <string>${xml(value)}</string>`).join("\n");
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
# Bound the restart loop: without this, a port held by another launcher turns
# Restart=on-failure into an endless EADDRINUSE storm. Reset after fixing the
# cause with: systemctl --user reset-failed dsh-update-status-web.service
StartLimitIntervalSec=${String(300)}
StartLimitBurst=${String(10)}

[Service]
Type=simple
WorkingDirectory="${systemd(spec.workspace)}"
${env}
ExecStart=${command}
Restart=on-failure
RestartSec=${String(3)}

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
$rapidWindowSeconds = ${String(30)}
$rapidLimit = ${String(5)}
$rapid = 0
while ($true) {
  $started = Get-Date
  & '${node}' '${dsh}' --profile '${powerShell(spec.profile)}' --host '${powerShell(spec.host)}' --port '${String(spec.port)}' --no-open 1>> '${out}' 2>> '${err}'
  $exitCode = $LASTEXITCODE
  $elapsed = ((Get-Date) - $started).TotalSeconds
  # A child that dies within the window never finished a boot; enough of them in a
  # row means another launcher owns the port, and respawning forever only spins.
  if ($elapsed -lt $rapidWindowSeconds) { $rapid = $rapid + 1 } else { $rapid = 0 }
  $note = "[dsh-update-status] supervisor: DSH exited with code $exitCode after $([int]$elapsed)s (rapid failure $rapid/$rapidLimit)"
  Write-Host $note
  # The service log is where a user looks; the console here is the task's own.
  Add-Content -LiteralPath '${err}' -Value $note -ErrorAction SilentlyContinue
  if ($rapid -ge $rapidLimit) {
    $note = "[dsh-update-status] supervisor: giving up after $rapidLimit rapid failures (last exit code $exitCode). Another process may hold the port; fix that, then re-run the scheduled task."
    Write-Host $note
    Add-Content -LiteralPath '${err}' -Value $note -ErrorAction SilentlyContinue
    exit 78
  }
  Start-Sleep -Seconds ${String(3)}
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
			wrapper: launchdWrapper(spec, paths, uid),
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
			recoverCommand: `launchctl kickstart -k ${domain}/${spec.label}`,
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
		recoverCommand: `systemctl --user reset-failed ${SYSTEMD_UNIT} && systemctl --user enable --now ${SYSTEMD_UNIT}`,
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
		recoverCommand: "schtasks.exe /Run /TN \"DSH Update Status Web\"",
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
export { WINDOWS_TASK_NAME as a, parseSystemdMainPid as c, bootStampFile as d, countRecentRestarts as f, serviceLogDir as h, SYSTEMD_UNIT as i, parseWindowsTaskRunning as l, recordBootStamp as m, specFromArgs as n, WINDOWS_WRAPPER_BASENAME as o, dshHomeOf as p, LAUNCHD_LABEL as r, parseLaunchdTrackedPid as s, planFor as t, RESTART_STORM_WINDOW_MS as u };
