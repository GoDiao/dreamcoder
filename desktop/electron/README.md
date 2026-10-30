# Electron shell

The desktop app is an Electron main process that starts the Bun sidecar (`src/server`) and shows the React frontend (`desktop/src`) in one window. The main process only does OS-level work: windows, menus, tray, notifications, dialogs, single instance, app mode. Everything else lives in the sidecar.

## How the page talks to the shell

`preload.ts` exposes `window.dreamcoderShell` with `contextBridge`: `invoke(command, args)`, `listen(event, handler)` and `pathForFile(file)`. The renderer runs with `contextIsolation` and `sandbox`, without Node. `desktop/src/lib/shell/index.ts` is the only module in the page that uses the bridge; components import from `lib/shell`. `main.ts` answers `shell:invoke` only from the main window, and errors come back without Electron's IPC prefix.

## Files

- `main.ts`: resolves the config directory and portable mode, starts the sidecar, opens the window (on the Vite dev server or on `dist/` through `dreamcoder://localhost` with a content security policy), the macOS menu, the tray, notifications and the `shell:invoke` handlers.
- `browser.ts`: the Browser tab's security boundary. The app window enables `webviewTag`; `will-attach-webview` accepts only the `persist:dreamcoder-browser` partition and a start address that passes `classifyUrl` (loopback `http`, `https`, or a project file), drops any preload and forces `sandbox`, `contextIsolation` and no `nodeIntegration`. Guests get no bridge. Their session denies every permission, device and display-capture request, and their navigation, redirects, popups and subframes are checked against the same rules; other schemes (`vscode:`, `zoommtg:`) are sent to the page for confirmation. Project HTML files are served by the `dreamcoder-project://<root id>/…` protocol on that session only, which resolves every path inside the registered project root and refuses symlinks that leave it. The partition lives under `userData`, so it follows `DREAMCODER_CONFIG_DIR`. Downloads use Electron's default save dialog.
- `sidecar.ts`: reserves a port and starts `dreamcoder-sidecar server --app-root … --host 0.0.0.0 --port …`, waits until the port accepts connections and passes recent logs on failure. The sidecar is stopped on quit (the whole process tree on Windows), and `DREAMCODER_PARENT_PID` lets it exit on its own if the main process dies.
- `appMode.ts`: portable mode. `app-mode.json` sits in the active config directory and in Electron's user data folder; the default portable folder is `CLAUDE_CONFIG_DIR` next to the executable. With a config directory, Electron's user data goes to `<config>/Electron`.
- `windowState.ts`: window bounds in Electron's screen coordinates, kept in `window-state.json` in the user data folder and restored only when they overlap a display.
- `sessionExport.ts`: writes session exports to the path picked in the save dialog (`.md`, `.markdown`, `.json`).
- `build/`: entitlements for the hardened runtime (the sidecar needs JIT), the NSIS hooks that stop running sidecars, the app icons and their sources.
- `../scripts/build-electron.ts`: bundles `main.ts` and `preload.ts` to `electron-dist/` and writes the app's `package.json` there.
- `../scripts/electron-dev.ts`: `bun run electron:dev`, which starts Vite and Electron together.
- `../electron-builder.json`: the macOS arm64 `.dmg` and the Windows x64 NSIS installer. `dist/`, the sidecar and `rg` go to `Resources`; the sidecar and `rg` sit side by side in `Resources/bin`.

## Run

From `desktop/`, after `bun install`:

```bash
bun run electron:install   # once: download the Electron binary
bun run build:sidecars     # build the sidecar and stage ripgrep in desktop/binaries
bun run electron:dev       # Vite on port 1420 plus Electron
```

`bun run build && bun run electron:start` runs the built frontend without packaging. In development builds, F12 or Ctrl/Cmd+Shift+I opens the developer tools.

## Package

```bash
bun run electron:pack
```

It builds the frontend, the sidecar and the main process, then the installer for the current platform in `electron-release/`. Local macOS builds are ad-hoc signed. The release workflow signs and notarizes when the signing secrets are set (see `.github/workflows/release.yml`).

electron-builder downloads helper tools (dmgbuild on macOS, NSIS on Windows) into its cache. To keep them inside the checkout, set `ELECTRON_BUILDER_CACHE=$PWD/.electron-cache/builder` for the build. `ELECTRON_CACHE` does the same for `electron:install`. Both folders are Git-ignored.
