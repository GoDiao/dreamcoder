English | [简体中文](./TROUBLESHOOTING_zh.md)

# Troubleshooting

Common issues when building or running DreamCoder, and how to fix them.

> **Want to contribute a fix?** See [CONTRIBUTING_en.md](CONTRIBUTING_en.md) for the PR workflow.
> Issues are tracked at [github.com/GoDiao/dreamcoder/issues](https://github.com/GoDiao/dreamcoder/issues).

---

## Build & Setup

### `failed to find binary 'dreamcoder-sidecar-...'`

**Symptom:** `bun run tauri dev` exits immediately with an error about a missing sidecar binary.

**Cause:** You skipped the `bun run build:sidecars` step. The `desktop/src-tauri/binaries/` directory is gitignored — a fresh clone has no sidecar binary until you compile one.

**Fix:**
```bash
cd desktop
bun run build:sidecars
bun run tauri dev
```

---

### `command not found: tauri` or `@tauri-apps/cli` not found

**Symptom:** Running `bun run tauri dev` complains that `tauri` or `@tauri-apps/cli` is missing.

**Cause:** `@tauri-apps/cli` lives in `desktop/package.json`'s `optionalDependencies`. The root `bun install` does **not** install it — you must also run `bun install` inside `desktop/`.

**Fix:**
```bash
cd desktop
bun install
bun run tauri dev
```

---

### `dist/` folder not found

**Symptom:** Tauri fails to launch because `desktop/dist/` is missing.

**Cause:** Tauri needs the Vite-built frontend assets. `bun run tauri dev` builds them automatically, but if you're running `cargo tauri` directly or something went wrong with the Vite step, the folder may not exist.

**Fix:**
```bash
cd desktop
bun run build          # produce dist/
bun run tauri dev
```

---

### Linux: WebKitGTK / GTK libraries not found

**Symptom:** On Linux, `bun run tauri dev` fails with errors about missing `webkit2gtk`, `libgtk-3`, `libappindicator`, `librsvg`, or similar shared libraries.

**Cause:** Tauri requires several system-level libraries that don't come pre-installed on most Linux distributions.

**Fix:** Install the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux). Package names vary by distribution:

| Distribution | Command |
|---|---|
| Arch Linux | `sudo pacman -S webkit2gtk-4.1 libgtk-3 libappindicator-gtk3 librsvg libsoup3` (community-verified, may need adjustment) |
| Ubuntu / Debian | See [Tauri docs](https://v2.tauri.app/start/prerequisites/#linux) |
| Fedora | See [Tauri docs](https://v2.tauri.app/start/prerequisites/#linux) |

> **Note:** The maintainer does not run Linux day-to-day. The Arch command above is a best-effort guess. If you confirm the correct package list for your distro, please open a PR to update this section.

---

## Runtime

### High memory usage (8–16 GB) / UI freeze / OOM kill

**Symptom:** After launching, DreamCoder's sidecar or WebView process grows to 8–16 GB of RAM, causing the UI to freeze or the OS to kill the process (OOM).

**Status:** Partially resolved — tracked in [#25](https://github.com/GoDiao/dreamcoder/issues/25).

**Confirmed on:** Windows 10 x64, Arch Linux.

**What we know so far:**

There appear to be **two separate issues**:

1. **Sidecar memory spike on startup** — `listSessions` was loading every session's full JSONL file into memory. Fixed in [#31](https://github.com/GoDiao/dreamcoder/pull/31): sidecar peak RSS dropped from ~2.5 GB to ~900 MB on a 48-session machine. If you're still on an older build, update to the latest `dev` / `master`.

2. **WebKitGTK memory leak (Linux-specific)** — On Linux with Tauri + WebKitGTK, `WebKitWebProcess` can grow at ~100 MB/s even when the sidecar is not running and the frontend behaves normally in a standalone browser. This suggests a Tauri/WebKitGTK-level issue, possibly specific to certain window managers (e.g. Hyprland).

For platform-specific investigation details, see [ENVIRONMENT_TESTING.md](ENVIRONMENT_TESTING.md).

---

### App launches but UI is blank / white screen

**Symptom:** The Tauri window opens but shows a blank white page.

**Cause:** Usually a Vite dev-server connection issue — the frontend dev server may not have started, or the port is blocked.

**Fix:**
1. Check that `bun run tauri dev` (not `bun run dev`) was used — `bun run dev` only starts Vite, not Tauri.
2. Try a production build instead: `cd desktop && bun run build && bun run tauri dev`.
3. Check the Tauri devtools console (right-click → Inspect) for errors.

---

## Contributing to this Guide

This file is community-maintained. If you hit a problem not listed here and figure out the fix:

1. Open an issue describing the problem and solution.
2. Once confirmed, open a PR adding your entry to this file.
3. Follow the format: **Symptom → Cause → Fix → (optional) Notes**.
