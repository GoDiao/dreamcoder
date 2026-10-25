# AGENTS.md

Guidance for coding agents (and humans) working on DreamCoder. Setup, build order and the contribution flow are in [docs/CONTRIBUTING_en.md](docs/CONTRIBUTING_en.md); this file covers what is easy to get wrong.

## Project layout

- `desktop/src`: desktop UI, React with zustand stores (`desktop/src/stores`).
- `desktop/electron`: the Electron main process and preload. The page reaches it only through `desktop/src/lib/shell`.
- `src/server`: the Bun server that runs as the app's sidecar. It starts one CLI process per session.
- `src`: the CLI, derived from Claude Code. The app drives it in `--print` stream-json mode.
- Session state lives on the server. The desktop app and the H5 page mirror it. New session state belongs in the server state store, not only in a client store. See [docs/session-state-tech-design.md](docs/session-state-tech-design.md).

## Checks

CI runs three checks on every PR to `main`. Run them locally before opening a PR:

```bash
bun test                    # server and CLI tests; needs ripgrep on PATH
cd desktop
bun run lint                # TypeScript type check (tsc --noEmit)
bun run test -- --run       # desktop tests (vitest)
```

## Code

- **New code has no comments.** No JSDoc, no inline comments, no comments in tests. Names and structure carry the meaning. Existing comments in code you don't touch can stay.
- TypeScript strict mode; avoid `any`. Match the style of the surrounding code.
- User-facing text goes through i18n keys, with both `desktop/src/i18n/locales/en.ts` and `zh.ts` updated. Don't hard-code strings.
- Use theme tokens for colors (e.g. `desktop/src/theme/`) and check both light and dark themes.
- Subscribe to the store with selectors for the fields a component uses, never the whole session object or the whole store. Use `useSessionField` and the other helpers in `desktop/src/stores/chatStore.ts`.

## Design

- **Reuse before you write.** Search for an existing helper, hook or component before adding one. UI building blocks live in `desktop/src/components/shared` (`Button`, `Dropdown`, `Modal`, `Switch`, …); HTTP calls go through `desktop/src/api`.
- **Don't duplicate logic.** If the same logic appears a second time, extract it into a function or hook in the module that owns that concept, and make both callers use it. Don't copy a block and tweak it.
- **One source of truth.** Don't keep a second copy of state that is owned elsewhere. Derive values instead of storing them (e.g. compute elapsed time from the turn's start time instead of counting in the store). Session state is owned by the server; clients read it.
- **One place per concern.** The sidecar owns business logic and configuration. The Electron main process in `desktop/electron` only does OS-level work (windows, tray, menus, notifications, single instance, dialogs) and asks the sidecar for anything else instead of computing it again.
- **Change the layer that owns the behavior.** UI components don't call the server directly; they go through stores and `desktop/src/api`. Server route and WebSocket handlers stay thin and call services in `src/server/services` and `src/server/session`. Session state changes go through the reducer in `src/server/session/state`.
- **Fix the cause, not the symptom.** Don't add a flag, retry or special case to hide a bug you haven't explained.
- **Keep the change as small as the problem.** No speculative abstractions, options or extension points. When new code replaces old code, delete the old path in the same PR instead of leaving both.
- **Protocol changes update both sides.** When a message or API shape changes, update the server, the desktop app, the H5 page and their types together.
- **Don't swallow errors.** Surface them to the user with an i18n message, or log them with enough context to debug; never an empty `catch`.
- **Keep rendering cheap.** No work in render that grows with the length of a session, and no store writes on a timer or on every stream chunk unless they are batched.

## Tests

- Every behavior change comes with a test.
- Tests must not leave process-wide state behind for later test files: restore anything global you change (interactive mode, the test global config, environment variables, module-level caches). CI runs files in filesystem order, which differs between machines, so a leak can pass locally and fail in CI.

## Self-check before opening a PR

Read your whole diff against `main` (`git diff main...HEAD`) and check:

- **Nothing left over.** No debug logging, temporary timing or test hooks, commented-out code, stray files, or unrelated reformatting. The lockfile changes only if you added a dependency.
- **No comments in added lines.** This catches most of them and skips URLs such as `https://`:
  ```bash
  git diff main...HEAD -U0 -- '*.ts' '*.tsx' '*.rs' | grep -nE '^\+(\s*(//|/\*|\*)|.*[^:]//|.*\s/\*)'
  ```
  It can still flag a `//` inside a string; check each hit before removing it.
- **Every place the change belongs.** Search for the field, setting or message type you touched and update every layer that uses it: server state, the desktop mirror, the H5 page, i18n in both languages, and their tests.
- **The paths around the happy path.** Errors and empty states; a page refresh or reconnect in the middle of a reply; the same session open in two clients; switching sessions.
- **Both themes and both languages** for UI changes.
- **Tests fail without your change.** A test that also passes on `main` doesn't cover the fix.
- **Tests pass in any order** when you touched shared or global state:
  ```bash
  bun test --randomize --seed=1 <the test files you touched>
  ```
- **The PR description matches the diff.** Every claim in it is something you ran or measured, not something you expect.

## Git and pull requests

- Branch from `main` with a prefix: `feat/`, `fix/`, `perf/`, `refactor/`, `docs/`, `test/`, `chore/`.
- Semantic commit messages, e.g. `fix(sidebar): avoid re-renders on streaming updates`.
- One PR does one thing; it is squash-merged into a single commit.
- Write PRs in English: what changed, why, and how you tested it. Link the issue with `Closes #N`, or `Part of #N` when it covers only part of it.
- Performance PRs include before/after numbers and say how they were measured.
- Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) in the PR, following the existing entries' style.
- Don't merge your own PR; the maintainer merges.

## Safety

- Never commit API keys, tokens or other secrets, including in tests, fixtures and logs.
- Don't read or copy the user's local session data (`~/.dreamcoder`, `~/.claude`).
- Don't add dependencies without discussing them in the issue first. Add them with `bun add` so the lockfile is updated.
- Don't change global state on the machine: no global package installs, no edits to global git config.
