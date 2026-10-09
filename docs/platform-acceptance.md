# Verifying on Linux or Windows

macOS is verified on a real machine. The Linux and Windows service templates are generated and covered by tests, but **have not been run on those systems yet** — that is what this page is for.

Three steps, each one safe to stop at. If a step fails, the section below says what to look at.

## 1. Look first — writes nothing

```sh
dsh plugin --profile web exec dsh-update-status-service plan --workspace "$PWD" --dry-run
```

Check the printed Node path, DSH path, absolute native-service command, port and **servicePath** against what you actually run. The default `current` value should contain the directories where your terminal finds the tools you need; warnings are visible before anything is written. Override launch facts with `--node`, `--dsh`, `--port`; use `--path-source minimal` for a fixed PATH, or `--service-path` (plus `--service-pathext` on Windows when needed) for an explicit one.

## 2. Write the service definition — still starts nothing

```sh
dsh plugin --profile web exec dsh-update-status-service install --workspace "$PWD"
```

It runs a boot precheck that does not bind the port and uses the exact same PATH that will be written into the service. If that precheck fails, nothing is written. The receipt keeps that PATH, its source, capture time, PATHEXT on Windows and all warnings; later commands reuse it instead of reading the shell that happens to invoke them.

## 3. Stop your terminal's `dsh web` yourself, then

```sh
dsh plugin --profile web exec dsh-update-status-service activate
```

It refuses to start while the port is still busy — that is deliberate, so the DSH you are using is never pushed aside.

Then reopen the Web UI and check that **Restart** in the update panel is enabled (not greyed out). That is the whole acceptance test: restart availability means the running process was recognised as service-managed.

One more check worth doing on a new machine: start something else on the same port (a second `dsh web`), then look at the panel. Restart should go grey within a few seconds, and the panel should show the two copy-only commands that recover it. Stop the extra instance and run the second command; the button comes back. That is the ceiling doing its job — the service tries a few times and then stops instead of filling the log forever.

## Where to look when something is off

| Platform | Status command |
| --- | --- |
| Linux | `systemctl --user status dsh-update-status-web.service` and `journalctl --user -u dsh-update-status-web.service -f` |
| Windows | Task Scheduler → **DSH Update Status Web**, or `schtasks /Query /TN "DSH Update Status Web" /V /FO LIST` |

If **Restart** stays greyed out after activating, the running process was not recognised as the service's process — most often because something else (a restart script, another plugin's helper, a hand-started `dsh web`) is holding the port and the service is failing to start. Check `lsof -nP -iTCP:<port> -sTCP:LISTEN` and the service log before reporting. For an issue report, include the `plan` output and the status output above.

## Removing it again

```sh
dsh plugin --profile web exec dsh-update-status-service uninstall
```

That removes only the definition this tool created. Logs are kept.
