# Electron shell (spike)

RFC #174 step 3. An Electron main process that runs the same frontend and the same Bun sidecar as the Tauri shell. The Tauri build is unchanged; the Electron build is selected at build time.

## How the shell is selected

`desktop/src/lib/shell/index.ts` is the Tauri implementation. `desktop/src/lib/shell/electron.ts` implements the same exports over the preload bridge (`window.dreamcoderShell`). When Vite runs with `DREAMCODER_SHELL=electron`, a resolver plugin in `vite.config.ts` swaps every import of `lib/shell/index.ts` for `lib/shell/electron.ts`. Without it nothing changes. `electron.test.ts` fails if the two modules stop exporting the same names and types.

## Files

- `main.ts`: starts the sidecar, opens the window, serves `dist/` on `dreamcoder://localhost` in production, and answers `shell:invoke` calls.
- `sidecar.ts`: reserves a port and starts `dreamcoder-sidecar server --app-root … --host 0.0.0.0 --port …` with the same environment as the Tauri shell, waits until the port accepts connections, and passes the recent logs on failure. The sidecar is killed on quit, and `DREAMCODER_PARENT_PID` lets it exit on its own if the main process dies.
- `preload.ts`: exposes `invoke` and `listen` with `contextBridge`. The renderer runs with `contextIsolation` and `sandbox`.
- `../scripts/build-electron.ts`: bundles `main.ts` and `preload.ts` to `electron-dist/` and writes the app's `package.json` there.
- `../electron-builder.json`: macOS arm64 `.dmg`. `dist/`, the sidecar and `rg` go to `Contents/Resources`.

## Run

Build the sidecar first (`bun run build:sidecars`, needs `rustc` on `PATH` for the host triple).

Development, against the Vite dev server:

```bash
DREAMCODER_SHELL=electron bun run dev
bun run electron:dev
```

Production build without packaging:

```bash
DREAMCODER_SHELL=electron bun run build
bun run electron:start
```

Packaged, unsigned `.dmg` in `electron-release/`:

```bash
bun run electron:pack
```

Electron downloads its binary on install. Set `ELECTRON_CACHE` and `electron_config_cache` to `desktop/.electron-cache` to keep it inside the checkout, then run `node node_modules/electron/install.js` (Bun does not run Electron's install script).
