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

   `activate` refuses to run while the requested port is occupied. It never kills an existing process; this prevents an `EADDRINUSE` crash loop.

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

It runs at login (`RunAtLoad`) and keeps DSH alive (`KeepAlive`). The plugin accepts page restart only when both the explicit marker and launchd's `XPC_SERVICE_NAME=com.idoall.dsh-update-status.web` identify the current process. A terminal process that merely has a similarly named environment variable is refused.

Useful native inspection commands:

```sh
launchctl print "gui/$(id -u)/com.idoall.dsh-update-status.web"
launchctl kickstart -k "gui/$(id -u)/com.idoall.dsh-update-status.web"
```

Use the plugin CLI `stop` or `uninstall`, not `kill`, to intentionally stop a `KeepAlive` service. Killing the DSH child alone asks launchd to start it again.

## Linux — systemd user service

The CLI stages:

```text
~/.config/systemd/user/dsh-update-status-web.service
```

It uses `Restart=on-failure`, so DSH's restart exit code causes systemd to relaunch it. It is a **user** service: normally it starts after that user logs in.

```sh
systemctl --user status dsh-update-status-web.service
journalctl --user -u dsh-update-status-web.service -f
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

The task starts at user logon with least privilege. The wrapper owns the long-running DSH child and restarts it after an intentional restart or unexpected exit. Use Task Scheduler to inspect the task named **DSH Update Status Web**.

Windows behavior must be verified on a Windows host before it is described as production-supported; use `plan --dry-run` to inspect the generated XML and wrapper first.

## Restart behavior and limits

The panel's flow is deliberately conservative:

1. It verifies that the **current** DSH process is supervised.
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
