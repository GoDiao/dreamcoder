English | [简体中文](./TROUBLESHOOTING_zh.md)

# Troubleshooting

Common issues when building or running DreamCoder, and how to fix them.

> **Want to contribute a fix?** See [CONTRIBUTING_en.md](CONTRIBUTING_en.md) for the PR workflow.
> Issues are tracked at [github.com/GoDiao/dreamcoder/issues](https://github.com/GoDiao/dreamcoder/issues).
> To report a bug from the app, use **More → Report a problem** in the sidebar. It shows your version, OS, provider type and recent errors, with keys and your home folder removed, and opens a new issue with the version filled in.

---

## Build & Setup

### `Electron failed to install correctly`

**Symptom:** `bun run electron:dev` stops with `Electron failed to install correctly, please delete node_modules/electron and try installing again`.

**Cause:** Bun does not run Electron's install script, so `bun install` leaves the Electron binary undownloaded.

**Fix:**
```bash
cd desktop
bun run electron:install
bun run electron:dev
```

---

### The window opens with "Local server failed to start"

**Symptom:** `bun run electron:dev` opens the window, which shows **Local server failed to start** with `sidecar failed to start: spawn … ENOENT`.

**Cause:** You skipped the `bun run build:sidecars` step. The `desktop/binaries/` directory is gitignored, so a fresh clone has no sidecar binary until you compile one.

**Fix:**
```bash
cd desktop
bun run build:sidecars
bun run electron:dev
```

---

### `Vite did not answer on http://localhost:1420`

**Symptom:** `bun run electron:dev` stops before the window opens.

**Cause:** Another process holds port 1420, or Vite failed to start (its error is printed above).

**Fix:** stop whatever listens on port 1420 (`lsof -i :1420` on macOS and Linux) and run `bun run electron:dev` again.

---

## Runtime

### High memory usage (8–16 GB) / UI freeze / OOM kill

**Symptom:** After launching, DreamCoder's sidecar or WebView process grows to 8–16 GB of RAM, causing the UI to freeze or the OS to kill the process (OOM).

**Status:** Partially resolved — tracked in [#25](https://github.com/GoDiao/dreamcoder/issues/25).

**Confirmed on:** Windows 10 x64, Arch Linux.

**What we know so far:**

There appear to be **two separate issues**:

1. **Sidecar memory spike on startup** — `listSessions` was loading every session's full JSONL file into memory. Fixed in [#31](https://github.com/GoDiao/dreamcoder/pull/31): sidecar peak RSS dropped from ~2.5 GB to ~900 MB on a 48-session machine. If you're still on an older build, update to the latest `dev` / `master`.

2. **WebKitGTK memory leak (Linux-specific)** — With the former Tauri shell on Linux, `WebKitWebProcess` could grow at ~100 MB/s even when the sidecar was not running and the frontend behaved normally in a standalone browser. The Electron shell does not use WebKitGTK; reports on whether Linux still shows the growth are welcome.

For platform-specific investigation details, see [ENVIRONMENT_TESTING.md](ENVIRONMENT_TESTING.md).

---

### App launches but UI is blank / white screen

**Symptom:** The DreamCoder window opens but shows a blank white page.

**Cause:** Usually a Vite dev-server connection issue: the frontend dev server may not have started, or the port is blocked.

**Fix:**
1. Check that `bun run electron:dev` (not `bun run dev`) was used. `bun run dev` only starts Vite.
2. Try the built frontend instead: `cd desktop && bun run build && bun run electron:start`.
3. Open the developer tools with F12 or Ctrl/Cmd+Shift+I (development builds only) and check the console for errors.

---

## Contributing to this Guide

This file is community-maintained. If you hit a problem not listed here and figure out the fix:

1. Open an issue describing the problem and solution.
2. Once confirmed, open a PR adding your entry to this file.
3. Follow the format: **Symptom → Cause → Fix → (optional) Notes**.
