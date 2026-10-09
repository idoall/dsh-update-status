# User-service supervision

The **Restart** control in DSH Update Status can safely request `process.exit(42)`, but a plugin runs inside the process it is asking to restart. It cannot relaunch itself. For a page restart to recover, DSH Web must therefore be owned by an external, **user-level** service manager.

This document describes the explicit, opt-in setup. The plugin never installs a service on its own, never kills a terminal-started DSH instance, and never copies shell secrets (such as API keys, npm tokens, or proxy credentials) into a service definition.

## Quick path

1. Install the plugin and build or install a version that includes the service CLI.
2. Preview the exact plan; this writes nothing and starts nothing:

   ```sh
   dsh plugin --profile web exec dsh-update-status-service plan \
     --workspace "$PWD" --dry-run
   ```

3. Stage the native user-service definition. This still does **not** start it:

   ```sh
   dsh plugin --profile web exec dsh-update-status-service install \
     --workspace "$PWD"
   ```

4. In the terminal that currently owns `dsh web`, stop it yourself with `Ctrl-C` after active work has finished.
5. Activate the staged service:

   ```sh
   dsh plugin --profile web exec dsh-update-status-service activate \
     --workspace "$PWD"
   ```

   `activate` refuses to run while the requested port is occupied, and it never kills an existing process. After starting the service it also verifies that the service really owns a running process: a service that begins crash-looping makes `activate` fail with that reason instead of reporting success.

6. Reopen the normal Web URL. The update panel should report a restart-capable supervised process. Perform the first real page restart yourself while present, then confirm that the page reconnects.

Use `status`, `stop`, and `uninstall` with the same `--workspace` argument for later maintenance. `uninstall` preserves logs.

> `dsh plugin --profile web exec` is pnpm's profile-local executable runner. Do not assume `dsh-update-status-service` is globally installed.

## What the installer records

The staged definition contains only explicit, non-secret launch facts:

- absolute Node and DSH CLI paths;
- profile, workspace, host, port, and `--no-open`;
- `DSH_HOME` when explicitly configured;
- an explicit `DSH_WEB_SUPERVISOR=dsh-update-status` marker;
- private stdout/stderr log paths.

It intentionally does **not** inherit the full terminal environment. If your DSH startup requires secret environment variables, configure them through your operating system's secret-management mechanism before activating the service; do not paste secrets into this plugin's configuration or issue tracker.

## macOS — LaunchAgent

The CLI stages a current-user plist at:

```text
~/Library/LaunchAgents/com.idoall.dsh-update-status.web.plist
```

It runs at login (`RunAtLoad`) and starts a small wrapper, also staged by the CLI:

```text
~/.dsh/dsh-update-status/dsh-web-supervisor.sh
```

The wrapper — not launchd — owns the restart loop, because `KeepAlive` can only respawn forever: if another launcher holds the port, every respawn dies with `EADDRINUSE` within a couple of seconds and the machine spins. The wrapper counts children that die before 30 seconds, stops after 5 of those in a row, writes why to the service log, and exits instead of respawning. A child that ran longer resets the counter, so ordinary restarts and long uptimes never trip it. The wrapper also forwards `SIGTERM` to its child, so `stop`/`uninstall` cannot leave an orphaned DSH behind holding the port.

The plugin accepts a page restart only when **both** hold:

- the explicit `DSH_WEB_SUPERVISOR=dsh-update-status` marker is present, and
- launchd reports this process (or its wrapper parent) as the tracked `pid` of the job labelled `com.idoall.dsh-update-status.web`.

The second check is the identity. Every descendant of a supervised process inherits the marker, so a process started by some other tool claims to be supervised while launchd is busy respawning a job that can never bind the port; the tracked pid cannot be inherited. The label is asked for by name rather than read from the environment: launchd does configure `XPC_SERVICE_NAME` for the job, but inside DSH — behind the staged `/bin/sh` wrapper — that variable reads `0`, so an environment check would refuse the very setup this plugin installs.

Useful native inspection commands:

```sh
launchctl print "gui/$(id -u)/com.idoall.dsh-update-status.web"
launchctl kickstart -k "gui/$(id -u)/com.idoall.dsh-update-status.web"
```

If the wrapper gave up, fix the cause (usually a second `dsh web` holding the port), then `launchctl kickstart -k` the job. Killing the wrapper itself is not a way back either: launchd no longer keeps a `KeepAlive` promise for it, which is precisely what bounds the loop — `kickstart` or the next login starts it again. Use the plugin CLI `stop` or `uninstall`, not `kill`, to intentionally stop the service: the wrapper forwards the signal to DSH.

## Linux — systemd user service

The CLI stages:

```text
~/.config/systemd/user/dsh-update-status-web.service
```

It uses `Restart=on-failure`, so DSH's restart exit code causes systemd to relaunch it, and it bounds the loop with `StartLimitIntervalSec=300` / `StartLimitBurst=10`: ten starts inside five minutes stops the unit instead of respawning forever. It is a **user** service: normally it starts after that user logs in.

```sh
systemctl --user status dsh-update-status-web.service
journalctl --user -u dsh-update-status-web.service -f
```

If the start limit tripped (usually because a second `dsh web` held the port), fix the cause and clear the limit before starting again:

```sh
systemctl --user reset-failed dsh-update-status-web.service
systemctl --user start dsh-update-status-web.service
```

To keep it alive after logout, a machine administrator may enable user lingering:

```sh
loginctl enable-linger "$USER"
```

The CLI deliberately does not enable lingering, because that changes account-level system behavior.

## Windows — Task Scheduler

The CLI stages a current-user Task Scheduler definition and a PowerShell wrapper below:

```text
%LOCALAPPDATA%\dsh-update-status\
```

The task starts at user logon with least privilege. The wrapper owns the long-running DSH child, restarts it after an intentional restart or unexpected exit, and stops after five starts that each die within 30 seconds (the same ceiling as macOS) instead of respawning forever. Use Task Scheduler to inspect the task named **DSH Update Status Web**.

Windows behavior must be verified on a Windows host before it is described as production-supported; use `plan --dry-run` to inspect the generated XML and wrapper first.

## One launcher, one port

Supervision only means something while the service is the only thing starting DSH Web on that port. Any other launcher — a second plugin's restart helper, a `nohup` restart script, a hand-started `dsh web` — takes the port for itself and leaves the service respawning a process that dies immediately. That is the one failure mode this plugin cannot fix from inside a page, so it detects and refuses it instead:

- restart availability requires the platform to report **this** process as the service's own (see each platform above);
- a restart storm (recent boot stamps plus DSH's own `startup-*.log` diagnostics, four within three minutes) is reported in the panel as its own reason;
- every generated definition carries a failure ceiling, and the wrapper/log line says which limit was reached.

Recovery is always the same: stop the extra instance, confirm the port is free (`lsof -nP -iTCP:3080 -sTCP:LISTEN`), then restart the service with the platform command above. The plugin never kills that other process for you — but it does hand you both commands: while a restart is refused, the panel and the settings card show the refusal reason followed by the two copy-only lines, taken from the installer's own receipt (the port) and the service plan (`recoverCommand`, which includes `systemctl --user reset-failed` on Linux because the unit's own start limit is what stopped the storm). With no receipt, the panel points at this document instead.

## Restart behavior and limits

The panel's flow is deliberately conservative:

1. It verifies that the **current** DSH process is supervised *and* that the platform service owns it.
2. It lists running agents, jobs, and terminals. If this inspection is incomplete, restart is refused.
3. If work is running, a second **Force restart** confirmation is required. A restart interrupts that work; it does not save or resume it.
4. The Host returns an accepted response, then exits with code `42` after a short grace period.
5. The browser polls for a different process instance ID for up to 60 seconds, then reloads.

If recovery times out, inspect the native service status and logs. An environment whose web authentication token is process-scoped may require reopening the URL printed in the service log; this plugin cannot universally promise that an existing browser cookie survives every DSH deployment.

## Repair and removal

Node/NVM upgrades can change the absolute Node path captured in a service definition. Re-run `plan --dry-run`, compare it with `status`, then stage a replacement only after reviewing the changed path. Do not edit a service definition while it is running.

To remove supervision without deleting DSH profiles, sessions, or plugin preferences:

```sh
dsh plugin --profile web exec dsh-update-status-service uninstall \
  --workspace "$PWD"
```

The command removes only the definition and receipt created by this installer. It preserves logs for diagnosis.
