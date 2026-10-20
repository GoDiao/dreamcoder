# Linux Browser Validation Report

English | [Chinese](LINUX_BROWSER_VALIDATION_zh.md)

DreamCoder's browser interface, Bun backend, and local Ollama model integration have been validated on Ubuntu 24.04. Dependency installation succeeded with an exFAT workaround, and the frontend build and frontend/backend connection passed. **This validation covers the browser version. The complete Linux Tauri desktop client, Anthropic Claude's official API, and OpenAI's official API remain unverified.**

For startup, data storage, dependency reinstallation, normal shutdown, and termination by PID, see the [browser usage and process termination guide](WEB_USAGE.md).

## Environment and Tested Revision

| Item | Validated environment |
| --- | --- |
| Validation date | October 20, 2026 |
| Operating system | Ubuntu 24.04.5 LTS |
| Revision used for runtime validation | `d5413e4a17dea867a7ea51b41dc2a052285c07bd` |
| Node.js | v24.22.0 LTS |
| npm | 11.19.1 |
| Bun | 1.4.2 |
| Frontend build tool | Vite 8.3.4 |
| Repository storage | exFAT on an external drive, mounted read/write |
| Frontend URL | `http://127.0.0.1:1420/` |
| Backend URL | `http://127.0.0.1:3456` |
| Model service | Local Ollama at `http://127.0.0.1:11434` |
| Validated model | `qwen3.8:latest` |

This documentation PR was prepared on a later `main` revision. The table records the revision actually used for runtime validation; these results do not automatically cover subsequent code changes. The listed versions describe the tested environment, rather than a compatibility guarantee for other versions or all Linux distributions.

## Dependency Installation Failure and Workaround

### EPERM Was Caused by Filesystem Link Restrictions

Earlier Bun installations in the repository root and `desktop/` produced many `Failed to link <package>: EPERM` errors. The repository and both existing `node_modules` directories belonged to the current user and were writable. Mount options included `rw`, `uid=1000`, `gid=1000`, `fmask=0022`, and `dmask=0022`.

Temporary directories were created in the repository root, `desktop/`, and both existing dependency directories to test actual filesystem operations. `/tmp`, located on a Linux filesystem, provided a control:

| Operation | Repository on exFAT | `/tmp` control |
| --- | --- | --- |
| Create a regular file | Passed | Passed |
| Rename a file | Passed | Passed |
| Create a symbolic link | `EPERM` | Passed |
| Create a hard link | `EPERM` | Passed |

All probe files were removed. Successful ordinary writes and failed link operations, together with the exFAT mount information, identified unsupported filesystem link operations as the cause.

Switching package managers alone did not resolve the issue. Standard npm installation also failed with `syscall symlink` and `EPERM`: the root install failed at `node_modules/.bin/mcpb`, and the desktop install failed at `node_modules/.bin/parser`.

### Local npm Installation Workaround

The existing failed dependency directories were renamed as backups before clean, separate installations in the root and `desktop/`. Neither directory had a usable `package-lock.json`, so `npm ci` was not used. Existing `bun.lock`, `desktop/bun.lock`, and `desktop/pnpm-lock.yaml` files were preserved, and no second official lockfile was generated.

The following commands were run from the repository root:

```bash
npm install --include=dev --include=optional \
  --package-lock=false --bin-links=false

npm --prefix desktop install --include=dev --include=optional \
  --package-lock=false --bin-links=false
```

The key option, `--bin-links=false`, skips creation of symbolic links for package executables. The two installations added 615 and 532 packages respectively, including devDependencies and optionalDependencies, without peer dependency conflicts. Neither `sudo npm install`, `chmod -R 777`, `--force`, nor `--legacy-peer-deps` was used.

This is a local workaround for exFAT; the filesystem restriction remains. Executable aliases under `.bin` cannot all be assumed to exist. A regular-file Vite launcher was created locally for npm scripts. It exists only in the ignored `node_modules` directory and is not committed as source. The usage guide also provides a fallback that invokes Vite directly with Node.

`--package-lock=false` does not make npm use the Bun or pnpm lockfile. Dependencies are resolved from the ranges in `package.json`, so this result is not an exact reproduction of the Bun lockfile or a completed Bun-to-Node.js migration.

## Frontend Build and Connectivity Checks

| Check | Result |
| --- | --- |
| Node engines | All installed packages declaring Node engine requirements were compatible with Node 24.22.0 |
| Root and desktop dependency trees | Both `npm ls --depth=0` commands exited successfully |
| Frontend build | `npm --prefix desktop run build` passed and transformed 4412 modules |
| Native dependency smoke checks | sharp generated a PNG, esbuild transformed TypeScript, and resvg rendered SVG to PNG |
| Page resources | HTML, entry JavaScript, the App module, and styles returned HTTP 200 |
| Backend health | `/health` returned HTTP 200 with `status: ok` |
| Basic APIs | `/api/status`, `/api/providers`, `/api/models`, and `/api/sessions` returned HTTP 200 |
| Cross-origin requests | Requests from the frontend origin succeeded; CORS preflight returned HTTP 204 |
| WebSocket | Received `connected`, then received `pong` after sending `ping` |
| Session interface | Session creation, renaming, and persistence after reload passed |
| Settings navigation | The Providers settings page opened successfully |

If reinstalling dependencies removes the Vite `.bin` alias, the same build entry point can be invoked directly from a terminal configured for Node 24 as described in the usage guide:

```bash
cd /path/to/dreamcoder/desktop
node node_modules/vite/bin/vite.js build
```

During connection setup, the browser initially sent `/health` to Vite on port `1420` and received HTML, causing startup to fail. Explicitly setting `VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456` and restarting the frontend resolved the connection without changing application source code.

The build retained one future compatibility warning: `__dirname` in `vite.config.ts` is unsupported by the native config loader planned as a future default. The current build passed, and that configuration was not changed.

npm 11 skipped unapproved install scripts for sharp, protobufjs, and esbuild by default. The native dependency smoke checks above passed separately; they do not cover every execution path. The installation-time audit also reported 28 dependency vulnerabilities in the root and 8 in desktop. No dependency upgrades or automatic fixes were applied.

## Model API Validation Scope

The current request path is: browser interface → local Bun backend → local Ollama → `qwen3.8:latest`.

| Service or capability | Validation status |
| --- | --- |
| Local Ollama model interaction | User interaction testing completed; verification confirmed Ollama as the active provider, a working model list, and local session user messages and assistant replies from the model |
| Ollama model list | Local `/api/tags` returned HTTP 200 and included `qwen3.8:latest` |
| Official Anthropic Claude API | Pending validation |
| Official OpenAI API | Pending validation |
| All tools, multi-turn recovery, and model behaviors | No comprehensive regression validation performed |

The Ollama provider uses `apiFormat: anthropic`, which selects the local service's compatible protocol. It does not demonstrate a successful request to Anthropic's official Claude service. Protocol compatibility likewise does not establish successful use of OpenAI's official API.

## Browser Version and Desktop Client Scope

The running application consists of the React/Vite browser frontend and Bun backend. This browser workflow does not require starting Rust, WebKitGTK, or Tauri. **The complete Linux Tauri desktop client was not built, packaged, or run.** Native windows, the system tray, installers, and automatic updates are outside this validation.

The complete client still requires Rust/Cargo, the relevant Linux graphical development libraries, a sidecar built for the target platform, and validation of Tauri startup and packaging. Those prerequisites and the sidecar binary were missing during the environment check; this work did not install them or execute that workflow.

The backend and build workflows also retain Bun dependencies, including:

- `src/server/index.ts` uses `Bun.serve`; static resources, sessions, and other services also use `Bun.file` and `Bun.spawn`.
- `desktop/scripts/build-sidecars.ts` uses `Bun.spawn` and `Bun.build` to compile the sidecar.
- Development and build hooks in `desktop/src-tauri/tauri.conf.json` still invoke Bun and require a sidecar executable.
- Root package scripts and the CLI launcher still invoke Bun.

## Startup and Shutdown Documentation

The accompanying [usage and process termination guide](WEB_USAGE.md) covers:

1. Starting the Bun backend and Vite frontend in separate terminals with an explicit backend URL.
2. Opening the browser interface, selecting a model provider, and confirming the session's project directory.
3. Checking backend health and handling URL errors, occupied ports, and a missing Vite launcher.
4. Stopping active tasks before shutting down both services with Ctrl+C.
5. Finding a PID by port when the original terminal is unavailable, checking its user, start time, command, and working directory, and then sending SIGTERM.
6. Using SIGKILL only after normal termination fails and the process identity has been checked again, followed by checks for occupied ports and remaining child processes.

Forced termination skips backend cleanup and may interrupt writes or leave child processes. The guide avoids terminating all processes named `node` or `bun`.

This PR contains only the validation report, usage guide, translations, and README entry. It excludes credentials, chat contents, raw runtime logs, dependency directories, and build artifacts.
