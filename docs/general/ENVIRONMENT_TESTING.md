# Environment

* **OS:** Archcraft Linux (Arch Linux based)
* **Desktop:** Hyprland (Wayland)
* **CPU:** Intel Core i5-12450H
* **RAM:** 16 GB
* **Swap:** 8 GB enabled
* **Rust:** 1.96.0
* **Bun:** 1.3.14
* **Node:** v26.2.0

# DreamCoder Version

* Tested on latest `master`
* Commit: `55b57ce`
* Includes memory fix from PR #31 (`listSessions` optimization)

# Observed Behavior

* DreamCoder launches successfully.
* Memory usage continuously increases over time.
* `WebKitWebProcess` grows up to **6–12 GB RSS**.
* `WebKitNetworkProcess` grows beyond **1 GB RSS**.
* Application UI eventually becomes **unclickable**.
* The system itself remains responsive due to the configured **8 GB swap**, but DreamCoder becomes unusable.
* Memory growth does not stabilize.

# Process Memory Observations

Approximate growth observed in `btop`:

* `WebKitWebProcess`: +100 MB/s
* `WebKitNetworkProcess`: +100–200 MB/s
* `dreamcoder-side`: ~131 MB RSS (stable)

# Investigation Performed

## Frontend-only test

Running:

```bash
cd desktop
bun run dev
```

and opening `http://localhost:1420` in Firefox does **not** reproduce the issue.

Firefox remains responsive and memory usage stays stable.

## Tauri test

Running:

```bash
WINIT_UNIX_BACKEND=x11 bun run tauri dev
```

reproduces the issue consistently.

## Mermaid test

Mermaid rendering was temporarily disabled inside `MermaidRenderer.tsx`.

Result:

* Memory leak still occurs.
* Mermaid does not appear to be the root cause.

## Sidecar test

The sidecar memory optimization from PR #31 appears effective.

Observed memory:

* `dreamcoder-side`: ~131 MB RSS and stable.

The Linux memory issue therefore appears independent of the sidecar memory leak.

# Current Hypothesis

The issue appears to be specific to:

* Tauri + WebKitGTK
* Linux WebView behavior
* Possibly Hyprland/Wayland interaction

Since the same frontend behaves normally in Firefox but leaks memory inside Tauri/WebKitGTK, the React frontend itself does not appear to be the primary cause.

# Status

* Sidecar memory leak: **Fixed**
* Firefox frontend: **Stable**
* Tauri/WebKitGTK memory growth: **Still reproducible**
* Linux issue: **Open**

