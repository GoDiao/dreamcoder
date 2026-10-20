# DreamCoder Browser Usage and Process Termination Guide

English | [Chinese](WEB_USAGE_zh.md)

This guide covers local development on Ubuntu 24.04, with Bun running the backend and Node.js/npm running the Vite frontend. Daily use does not require reinstalling dependencies, rebuilding the frontend, or compiling Tauri and the sidecar.

Ensure `bun`, `node`, and `npm` are available on your `PATH`. Node.js 24 LTS is recommended; the tested versions were Node.js `v24.22.0`, npm `11.19.1`, and Bun `1.4.2`. Replace `/path/to/dreamcoder` with your checkout directory.

For the validation scope, exFAT installation diagnosis, and Ollama results, see the [Linux browser validation report](LINUX_BROWSER_VALIDATION.md).

## Standard Dependency Installation

For the initial setup or after dependency changes, install dependencies separately in the repository root and `desktop/` using the project's standard Bun workflow:

```bash
cd /path/to/dreamcoder
bun install
(cd desktop && bun install)
```

These commands use the repository's Bun lockfiles. On a typical Linux filesystem with symbolic-link support, such as ext4, use this workflow. Daily startup does not require repeating installation. If link operations fail with `EPERM` on exFAT, see Known Issues below before considering the npm workaround.

## Daily Startup

If both services are already running, open <http://127.0.0.1:1420/>. After a reboot or shutdown, start them as follows. Avoid launching duplicate instances.

### Terminal A Starts the Backend

```bash
cd /path/to/dreamcoder

bun run src/server/index.ts --host 127.0.0.1 --port 3456
```

The following log confirms that the backend has started. Keep terminal A running.

```text
[Server] Claude Code API server running at http://127.0.0.1:3456
```

### Terminal B Starts the Frontend

```bash
cd /path/to/dreamcoder

VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456 \
  npm --prefix desktop run dev -- \
  --host 127.0.0.1 --port 1420 --strictPort
```

Once Vite prints its URL, open <http://127.0.0.1:1420/> and keep terminal B running. Retain `VITE_DESKTOP_SERVER_URL` in the startup command so the frontend connects to the intended backend.

| Service | URL | Purpose |
| --- | --- | --- |
| Frontend | `http://127.0.0.1:1420/` | Browser interface |
| Backend | `http://127.0.0.1:3456` | API and WebSocket |
| Health check | `http://127.0.0.1:3456/health` | Confirm that the backend is responding |

These commands listen only on the local loopback interface. Other computers and phones cannot access the application through this address.

## Using the Application and Saving Data

1. Open the page. Saved provider settings and chat history are loaded automatically.
2. If no model is configured, click **Add Provider** or open **Settings → Providers** to configure the provider, API key, and model.
3. Click **New session**. Before running a task, confirm that its working directory points to the intended project.

The provider validated here is local Ollama with `qwen3.8:latest`. Before use, ensure that your Ollama service is running and the selected model is installed. Calls to the official Anthropic Claude and OpenAI APIs remain unverified; a successful local compatible-protocol request does not replace those checks.

**The directory used to start the server is not necessarily the session's working directory.** During this validation, new sessions defaulted to the current user's home directory. Confirm the actual project path in the interface.

Unless `DREAMCODER_CONFIG_DIR` is set, configuration and chat data are stored under `$HOME/.dreamcoder/`. Include that directory in backups and protect any credentials it contains. If the environment variable is set, use the configured directory instead.

## Normal Shutdown

Stop generation in the interface and wait for any active task to finish, then press **Ctrl+C** in terminals A and B. On receiving a shutdown signal, the backend cleans up CLI child processes for active sessions.

Closing the browser page alone does not stop the services. If the original terminals are unavailable, follow the process termination steps at the end of this guide.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| The page does not open | Check that terminal B is still running and inspect Vite errors |
| Backend health check fails in the interface | Check terminal A and confirm that the frontend command includes `VITE_DESKTOP_SERVER_URL` |
| A port is already in use | Try the existing page first; if a restart is needed, identify and stop the old service using the steps below |
| No provider is configured | Check the provider and selected model in **Settings → Providers** |
| `vite: not found` | Complete both standard installation steps; if using the exFAT workaround, see its Vite fallback below |

### Check the Backend

Run this in another terminal:

```bash
curl -fsS http://127.0.0.1:3456/health
```

A healthy response contains `"status":"ok"`. Connection refusal means that no backend service can currently be reached at that address.

## Known Issues

### exFAT Link Errors and the npm Workaround

The validated checkout was on exFAT, where ordinary writes and renames worked but symbolic and hard links failed with `EPERM`. Standard npm installation also failed when creating executable links. The [validation report](LINUX_BROWSER_VALIDATION.md) records the probes and diagnosis. An `EPERM` error alone does not establish this cause: check ownership, permissions, filesystem type, and actual link support before applying a workaround.

Only for a checkout affected by this confirmed filesystem restriction, back up failed dependency directories before a clean retry and use the following local workaround:

```bash
cd /path/to/dreamcoder

npm install --include=dev --include=optional \
  --package-lock=false --bin-links=false

npm --prefix desktop install --include=dev --include=optional \
  --package-lock=false --bin-links=false
```

This is not the standard installation workflow for ext4 or other filesystems supporting symbolic links. These commands preserve existing lockfiles and do not generate an npm lockfile, but npm resolves the version ranges in `package.json` rather than following `bun.lock`, so installed versions can differ. `--bin-links=false` skips executable links and does not remove the underlying filesystem restriction.

Do not use `sudo npm install` or `chmod -R 777` to address this restriction. After moving to a filesystem that supports symbolic links, use the standard Bun installation workflow above.

### Missing Vite Launcher After the exFAT Workaround

If dependencies were installed with `--bin-links=false`, the Vite `.bin` launcher may be absent. The validated environment used a separately created regular-file launcher, which may also be lost when `node_modules` is removed or reinstalled. In this case, invoke Vite directly in terminal B:

```bash
cd /path/to/dreamcoder/desktop

VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456 \
  node node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 1420 --strictPort
```

The backend in terminal A must still be running.

## Process Termination Guide

Use this section when the original terminal is unavailable, a service remains running, or a port is occupied. Stopping the backend interrupts active tasks, so stop them in the interface first. Prefer **Ctrl+C** whenever the original terminal is available.

Every `PID` below is a placeholder. Replace it with a process ID from the current inspection. Do not execute the placeholder literally or reuse a PID from a previous run.

### Step 1 Find the Process Listening on the Port

Run these read-only commands:

```bash
lsof -nP -iTCP:1420 -sTCP:LISTEN
lsof -nP -iTCP:3456 -sTCP:LISTEN
```

The `PID` column identifies the listener. You can also inspect both ports with:

```bash
ss -ltnp '( sport = :1420 or sport = :3456 )'
```

If the commands run successfully and show no matching listener, there is no listening process to kill for that port. An occupied port does not by itself identify DreamCoder; inspect the process before stopping it.

### Step 2 Confirm the Process Identity

Replace `PID` with the number you just found and inspect its user, start time, full command, and working directory:

```bash
ps -ww -p PID -o pid,ppid,user,lstart,args
readlink -f /proc/PID/cwd
```

The frontend started by this guide is normally a `node` process running `vite.js` with its working directory in the checkout's `desktop/`. The backend command should include `bun run src/server/index.ts`, with the checkout as its working directory. If the command differs, use the actual paths to establish its identity.

Stop only processes you started and have confirmed belong to this DreamCoder instance. Establish the purpose of another project's or another user's process before taking action.

### Step 3 Request Normal Termination

After confirming the target, run:

```bash
kill -TERM PID
```

If both services need to stop, repeat this for each confirmed PID. `SIGTERM` lets the backend run its shutdown cleanup, including stopping active session CLI child processes.

Wait a few seconds, then check the ports again:

```bash
lsof -nP -iTCP:1420 -sTCP:LISTEN
lsof -nP -iTCP:3456 -sTCP:LISTEN
```

Once the ports are free, restart using the steps at the beginning of this guide. If a new process immediately takes a port, inspect its new PID, command, and parent process. Stop a service through its process manager if one is managing it.

### Step 4 Force Termination Only If the Process Does Not Exit

Only if the process remains after `SIGTERM`, inspect its PID, start time, and command again with `ps`. Confirm that it is still the same DreamCoder process, then run:

```bash
kill -KILL PID
```

This is equivalent to `kill -9 PID`. Forced termination with `SIGKILL` skips application cleanup and may interrupt writes or leave CLI child processes. Use it as a last resort. Check both ports afterward and inspect any remaining process individually before stopping it.

Avoid `killall node`, `killall bun`, broad `pkill -f` commands, or `fuser -k` without checking the target. They can terminate unrelated projects. Never use `0`, `1`, or a negative value as the target PID.

Stopping processes does not require deleting `node_modules`, chat history, `$HOME/.dreamcoder/`, or application source files.
