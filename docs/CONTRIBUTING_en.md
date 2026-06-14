# Contributing to DreamCoder

Thank you for your interest in DreamCoder! Whether you're reporting a bug, suggesting a feature, or submitting code, all contributions are welcome.

## ⚡ 5-Minute Quick Start (TL;DR)

```bash
# 1. Fork on GitHub, then clone your fork (Bun >= 1.0, Rust, Node >= 18 required)
git clone https://github.com/<your-name>/dreamcoder.git && cd dreamcoder

# 2. Install root workspace deps (sidecar runtime)
bun install

# 3. Install desktop deps (Tauri CLI + React frontend)
cd desktop && bun install

# 4. Compile the sidecar binary (without this, step 5 fails — externalBin can't find it)
bun run build:sidecars

# 5. Start the desktop app in dev mode
bun run tauri dev

# 6. Pick an issue with the `good first issue` or `help wanted` label,
#    create a feature branch from `dev`
git checkout dev && git checkout -b feat/your-feature

# 7. Code → bun run lint → bun run test → push → open a PR targeting `dev`
```

👉 **First time?** Browse [good first issues](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22). Each one has a mentor — feel free to ping them in the issue or PR.

---

## Code of Conduct

- Respect every contributor.
- Keep discussions constructive; no personal attacks.
- If you discover a security vulnerability, please contact the maintainer privately instead of filing a public Issue.

## How to Contribute

### Report a Bug

1. Search [Issues](https://github.com/GoDiao/dreamcoder/issues) to see if it has already been reported.
2. If not, open a new Issue with:
   - **Environment**: OS version, DreamCoder version (Settings → About).
   - **Steps to reproduce**: Clearly describe the actions that trigger the bug.
   - **Expected vs actual behavior**.
   - **Screenshots or logs** (if available).

### Feature Request

1. Search existing Issues first to avoid duplicates.
2. Open a new Issue describing:
   - What problem you want to solve.
   - What the feature should look like.
   - Why it's valuable to you.

### Submit Code

1. **Fork the repo** and create a feature branch from `dev`:
   ```bash
   git checkout dev
   git checkout -b feat/your-feature-name
   ```

2. **Develop**. Follow the project's code style:
   - TypeScript strict mode, avoid `any`.
   - React function components + Hooks.
   - Zustand for state management.
   - Tailwind CSS v4 for styling.

3. **Commit**. Use semantic commit messages:
   ```
   feat: add XXX feature
   fix: fix XXX issue
   refactor: refactor XXX
   docs: update XXX docs
   chore: miscellaneous changes
   ```

4. **Test**. Make sure your changes don't break existing functionality:
   ```bash
   cd desktop
   bun run lint    # TypeScript type checking
   bun run test    # run tests
   ```

5. **Submit a PR**. Target the `dev` branch. Describe what you changed and why.

## Project Structure

```
dreamcoder/
├── desktop/               # Tauri desktop app
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── stores/        # Zustand state management
│   │   ├── lib/           # Utilities & runtime
│   │   ├── hooks/         # React Hooks
│   │   ├── pages/         # Page components
│   │   └── i18n/          # Internationalization
│   └── src-tauri/         # Rust backend
├── sidecar/               # Bun backend service
├── docs/                  # Documentation
└── adapters/              # Third-party platform adapters
```

## Development Environment

> ⚠️ **Platform support note**
>
> DreamCoder is currently developed and verified on **Windows x64 only**.
> The codebase includes platform branches for macOS / Linux but the maintainer does not
> run those platforms day-to-day. If you're on macOS or Linux:
>
> - The desktop app **may** build and run, but you may hit untested issues
>   (see [#25](https://github.com/GoDiao/dreamcoder/issues/25) for an active Linux memory investigation).
> - Bug reports and platform-fix PRs are **highly welcome** — you'd be the first user on that platform.
> - For first-time contributors on Linux specifically, consider easier non-runtime tasks
>   (e.g. docs, i18n string fixes) before you've confirmed your build works.

```bash
# Prerequisites
# - Bun >= 1.0
# - Rust (for compiling Tauri)
# - Node.js >= 18
# - Linux also needs WebKitGTK, libappindicator, librsvg, etc.
#   See https://v2.tauri.app/start/prerequisites/

git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# Step 1: install root workspace deps (sidecar: Anthropic SDK, AWS SDK, ink, etc.)
bun install

# Step 2: install desktop deps (Tauri CLI + React frontend)
cd desktop && bun install

# Step 3: compile the sidecar binary
#   Produces desktop/src-tauri/binaries/dreamcoder-sidecar-<target>
#   tauri.conf.json's externalBin points at it; step 4 fails to launch without it.
bun run build:sidecars

# Step 4: launch dev mode
bun run tauri dev
```

> Seeing `failed to find binary 'dreamcoder-sidecar-...'`?
> 99% chance you skipped Step 3 `bun run build:sidecars`.
> Seeing `command not found: tauri` or a `@tauri-apps/cli` error?
> 99% chance you skipped Step 2 `cd desktop && bun install` (Tauri CLI lives in the desktop sub-package; root install won't pull it in).

## License

By contributing, you agree that your code will be licensed under the [MIT License](LICENSE).
