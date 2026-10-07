# Verifying on Linux or Windows

macOS is verified on a real machine. The Linux and Windows service templates are generated and covered by tests, but **have not been run on those systems yet** — that is what this page is for.

Three steps, each one safe to stop at. If a step fails, the section below says what to look at.

## 1. Look first — writes nothing

```sh
dsh plugin --profile web exec dsh-update-status-service plan --workspace "$PWD" --dry-run
```

Check the printed Node path, DSH path and port against what you actually run. Override any of them with `--node`, `--dsh`, `--port`.

## 2. Write the service definition — still starts nothing

```sh
dsh plugin --profile web exec dsh-update-status-service install --workspace "$PWD"
```

It runs a boot precheck that does not bind the port. If that precheck fails, nothing is written.

## 3. Stop your terminal's `dsh web` yourself, then

```sh
dsh plugin --profile web exec dsh-update-status-service activate --workspace "$PWD"
```

It refuses to start while the port is still busy — that is deliberate, so the DSH you are using is never pushed aside.

Then reopen the Web UI and check that **Restart** in the update panel is enabled (not greyed out). That is the whole acceptance test: restart availability means the running process was recognised as service-managed.

## Where to look when something is off

| Platform | Status command |
| --- | --- |
| Linux | `systemctl --user status dsh-update-status-web.service` and `journalctl --user -u dsh-update-status-web.service -f` |
| Windows | Task Scheduler → **DSH Update Status Web**, or `schtasks /Query /TN "DSH Update Status Web" /V /FO LIST` |

If **Restart** stays greyed out after activating, the running process was not recognised as the service's process. For an issue report, include the `plan` output and the status output above.

## Removing it again

```sh
dsh plugin --profile web exec dsh-update-status-service uninstall --workspace "$PWD"
```

That removes only the definition this tool created. Logs are kept.
