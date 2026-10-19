English | [简体中文](./CONTRIBUTING_zh.md)

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

# 4. Compile the sidecar binary (without this, step 6 fails — externalBin can't find it)
bun run build:sidecars

# 5. Build the frontend once (creates desktop/dist, which tauri dev requires)
bun run build

# 6. Start the desktop app in dev mode
bun run tauri dev

# 7. Pick an issue with the `good first issue` or `help wanted` label,
#    create a feature branch from `main`
git checkout main && git checkout -b feat/your-feature

# 8. Code → bun run lint → bun run test → push → open a PR targeting `main`
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

1. **Fork the repo** and create a feature branch from `main`:
   ```bash
   git checkout main
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
   bun test                  # server/CLI tests (needs ripgrep on PATH)
   cd desktop
   bun run lint              # TypeScript type checking
   bun run test -- --run     # desktop tests
   ```
   CI runs the same three checks on every PR to `main`.

5. **Submit a PR**. Target the `main` branch. Describe what you changed and why.

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
├── src/                   # CLI and backend server (src/server/)
└── docs/                  # Documentation
```

Provider preset contributions have a focused guide in the website documentation under "Adding Provider Presets".

## Development Environment

> ⚠️ **Platform support note**
>
> DreamCoder is developed and verified primarily on **Windows x64**.
> **macOS (Apple Silicon)** runs from source (`bun run tauri dev`) and is used by the maintainer
> during development, but packaged macOS builds are not verified yet.
> The codebase also includes Linux branches, but the maintainer does not run Linux day-to-day.
> If you're on Linux, or building a packaged macOS app:
>
> - The desktop app **may** build and run, but you may hit untested issues
>   (see [#25](https://github.com/GoDiao/dreamcoder/issues/25) for an active Linux memory investigation).
> - Bug reports and platform-fix PRs are **highly welcome**.
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
#   tauri.conf.json's externalBin points at it; step 5 fails to launch without it.
bun run build:sidecars

# Step 4: build the frontend once
#   Produces desktop/dist. tauri.conf.json bundles it as a resource, so step 5
#   fails without it even though dev mode serves the UI from Vite.
bun run build

# Step 5: launch dev mode
bun run tauri dev
```

> Seeing `failed to find binary 'dreamcoder-sidecar-...'`?
> 99% chance you skipped Step 3 `bun run build:sidecars`.
> Seeing `command not found: tauri` or a `@tauri-apps/cli` error?
> 99% chance you skipped Step 2 `cd desktop && bun install` (Tauri CLI lives in the desktop sub-package; root install won't pull it in).
> Seeing ``resource path `../dist` doesn't exist``?
> You skipped Step 4 `bun run build`.
>
> More common issues in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Adding an MCP Server to the Curated Registry

DreamCoder ships a small, reviewed catalog of MCP servers in
[`mcp-registry.json`](../mcp-registry.json) at the repository root. The contract
lives in [`src/server/mcpRegistry/schema.ts`](../src/server/mcpRegistry/schema.ts).

This catalog is **not** the official MCP URL registry used for trust checks.
The curated catalog only describes servers DreamCoder has reviewed and will
install locally; the official registry is a separate, remote source of truth.

### v1 scope

v1 is **stdio only**. HTTP and SSE entries are out of scope until the install
flow can express remote transports.

### Entry contract

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Stable, lowercase-dash-separated. Never reuse an id for a different server. |
| `name` | yes | Display name shown in the UI. |
| `description` | yes | What the user gets. Say *what* it does, not how. |
| `transport` | yes | Must be `stdio` in v1. |
| `command` | yes | Package name or relative path. Absolute paths and shell metacharacters are rejected. |
| `args` | no | May reference `{env:VAR_NAME}` placeholders. |
| `env` | no | Declares variable **names** and where the value comes from. |
| `homepage` | yes | Project homepage or repository URL. |
| `tags` | yes | Lowercase, at least one. |
| `runtime` | yes | `node`, `bun`, `python`, `uvx` or `binary`. |
| `version` | conditional | **Required** for `runtime: binary`; recommended for `uvx`. |

### Reviewed installation

The catalog review translates supported package metadata into an executable and
separate arguments. These command forms illustrate the resulting configuration:

| Catalog runtime | Automatic configuration |
| --- | --- |
| `node` | `npx --yes -- <package>@<version>` |
| `bun` | `bun x --bun <package>@<version>` |
| `uvx` | `uvx --no-python-downloads <package>@<version>` |

Only plain package identifiers and exact versions are supported: npm SemVer for
Node/Bun and a conservative exact PEP 440 subset for uvx. Omitted versions remain
unpinned and omit the suffix. Tags, ranges, `python`, `binary`, relative paths,
and other ambiguous metadata require the manual editor. The host must already
have the required runner/runtime. Opening review neither saves nor starts a
server; after confirmation, the connection check may download the package into
the runner's cache and start it.

Users explicitly choose `local` (private to one selected project), `project`
(shared `.mcp.json` in the selected project), or `user` (all projects).
Both `user` and `system` environment declarations require explicit input;
`optional` inputs are omitted when blank unless an argument references them.
`{env:NAME}` substitution preserves each argument and the exact input value,
while the review masks values. Confirmation stores values in the selected
existing configuration file: project scope shares them through `.mcp.json`, so
keep secrets out of committed configuration.

### Security rules

- **Never commit a secret.** `env` entries describe *what* is needed
  (`name`, `source`, `description`) — the value is supplied by the user at
  install time. Validation rejects an entry that carries a `value` field or a
  token-shaped string in `args`.
- **No absolute paths.** `command` must be a package name or relative path so a
  catalog edit cannot point at an arbitrary binary on a user's machine.
- **Pin what you can.** An unpinned `binary` entry can change behaviour on every
  install, so v1 requires an exact version.

### Validate your entry

```bash
# validates the whole shipped catalog plus the invalid-entry test cases
bun test ./src/server/__tests__/mcp-registry.test.ts
```

Validation collects **every** problem in one pass and reports a dotted path per
error (e.g. `servers.3.homepage`), so fix them in a single editing round rather
than one error per run.

### Review expectations

- Prefer servers from the [official MCP servers repo](https://github.com/modelcontextprotocol/servers)
  or a well-maintained project with an active release history.
- Use an exact `version` for anything installed via `uvx` or as a binary.
- Keep `description` user-facing: it is rendered in the catalog UI.
- One PR per entry (or a small related batch) keeps review fast.

Tracking issue: [#44](https://github.com/GoDiao/dreamcoder/issues/44) ·
Parent: [#12](https://github.com/GoDiao/dreamcoder/issues/12)

## License

By contributing, you agree that your code will be licensed under the [MIT License](LICENSE).
