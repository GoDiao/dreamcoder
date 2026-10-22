<div align="right">

English | [简体中文](./ISSUE_120_IMPLEMENTATION_REPORT_zh.md)

</div>

# Issue #120 Implementation Report

> Let providers have any number of models, with an optional fast model

- Issue: [GoDiao/dreamcoder#120](https://github.com/GoDiao/dreamcoder/issues/120)
- Implementation status: Complete locally
- Manual validation status: Passed with local Ollama only
- Remote API validation: OpenAI/OpenAI-compatible cloud API pending; Anthropic API pending
- Validation platform: Windows x64
- Report date: October 22, 2026

## 1. Summary

Issue #120 removes DreamCoder's application-level limit of four provider models. Providers now store an ordered list of `{ id, name? }` entries and may select one entry as `fastModel`. Claude's internal role variables remain supported, but DreamCoder fills them automatically from the session model and the provider's fast model instead of asking users to understand `main`, `haiku`, `sonnet`, and `opus`.

This change includes the provider schema, storage migration, presets, server-side model discovery, desktop model editing, the cross-provider session picker, runtime environment mapping, title generation, scheduled tasks, context-window lookup, tests, and fixtures.

## 2. Issue requirement-by-requirement implementation

The table below maps each requirement in Issue #120 to its implementation and current verification status.

| # | Issue requirement | Implementation | Verification status |
| ---: | --- | --- | --- |
| 1 | A provider can contain any number of models. | Replaced the four role fields with an ordered `ProviderModel[]` in `src/server/types/provider.ts` and the matching desktop types. | Automated tests passed; local Ollama manual test passed with three models. |
| 2 | Model IDs are unique within a provider. | `ProviderModelsSchema` reports a validation issue for duplicate IDs; create/update service validation uses the normalized list. | Automated schema/service tests passed; duplicate-ID behavior manually checked with Ollama configuration. |
| 3 | Add a server-side **Fetch models** action. | Added `POST /api/providers/models` for unsaved configuration and `POST /api/providers/:id/models` for saved providers. Both call `fetchUpstreamModels` in `src/server/upstream/client.ts`. | Mocked integration tests passed; local Ollama `/v1/models` manual test passed. |
| 4 | OpenAI-compatible and Anthropic model-list authentication must be supported without exposing keys to browser CORS. | Discovery runs in the sidecar. OpenAI-compatible requests use Bearer auth; Anthropic requests use the configured Anthropic strategy and `anthropic-version`. | Unit/mocked integration coverage passed. Real remote OpenAI and Anthropic APIs have not yet been manually tested. |
| 5 | Discovery results are candidates and are not automatically persisted. | The desktop store keeps discovered models in transient form state. Only the explicit provider save operation writes the selected model list. | Component/store tests passed; cancel/reopen behavior passed in the local Ollama manual flow. |
| 6 | Users can select a discovered model or type an ID manually, then press **Add**. | `ProviderFormModal.tsx` uses an editable input with discovered suggestions and retains manual input when discovery is unavailable. | Component tests passed; local Ollama discovered-model flow passed. Manual fallback is covered by tests. |
| 7 | Added models can be removed and ordered. | The model editor renders the ordered list with remove, move-up, and move-down controls. The first model is marked as the default. | Component tests passed; local Ollama manual test passed. |
| 8 | Models have an optional editable display name, with ID fallback and visible ID. | Each entry stores `{ id, name? }`. Discovery accepts `display_name` or `name` as a suggestion. Settings show the editable name and the immutable ID; pickers fall back to the ID. | Parser and UI tests passed; local Ollama names were manually edited and persisted. |
| 9 | Duplicate display names warn but do not invalidate different model IDs. | The provider form computes duplicate non-empty names and renders a warning while leaving save eligibility based on unique IDs. | Component tests passed; manually checked in the Ollama provider form. |
| 10 | A provider may select one of its own models as the optional fast model. | Added `fastModel?: string`; service validation requires it to reference the provider's model list. Removing that model clears the selection. | Runtime/service/component tests passed; `qwen3.5:4b` passed as the local Ollama fast model. |
| 11 | The session picker lists all models from all providers by display name while passing IDs. | `ModelSelector.tsx` flattens every provider model, shows name with ID context, and stores provider ID plus model ID in the runtime selection. | Picker tests passed; local Ollama session switching passed. Cross-provider behavior is covered by tests. |
| 12 | The selected model fills main, Sonnet, and Opus roles. | `buildProviderManagedEnv` maps the selected model to `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `ANTHROPIC_DEFAULT_OPUS_MODEL`. | Runtime and conversation integration tests passed. Local Ollama selected-model requests passed. |
| 13 | The fast model fills Haiku and Small Fast roles, falling back to the selected model. | The same runtime builder maps `fastModel ?? selectedModel` to `ANTHROPIC_DEFAULT_HAIKU_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL`. | Tests cover both configured and fallback cases; the local Ollama fast-model flow passed. |
| 14 | Display names must never be sent upstream. | Runtime configuration, proxy requests, session overrides, and scheduled tasks use `model.id`; `name` remains UI metadata only. | Unit/integration tests passed; Ollama `/status` and local requests used the real IDs. |
| 15 | Session titles use the fast model or fall back to the selected model. | `titleService.ts` resolves the provider fast model first and otherwise uses the selected/first model; the WebSocket handler supplies the current runtime model. | Title tests passed; local Ollama manual title flow passed. Remote providers remain pending. |
| 16 | Scheduled tasks use their selected model, or the provider's first model, with the same fast-model behavior. | `cronScheduler.ts` passes the task model into provider runtime resolution; the provider default is the first list item. | Scheduler launcher tests passed; no separate remote-provider manual run yet. |
| 17 | Existing four-slot providers migrate without losing models. | Storage schema version 2 converts `main`, `sonnet`, `opus`, `haiku` in that order, removes blanks and duplicates, and makes a distinct legacy `haiku` the fast model. | Migration tests passed, including duplicate inputs. The manual run used a newly configured Ollama provider; legacy migration was not separately manually exercised. |
| 18 | Presets use the new list shape. | `providerPresets.json` now uses `defaultModels: { id, name? }[]` and optional `defaultFastModel`. | Preset tests passed. |
| 19 | All former `models.main`/`haiku`/`sonnet`/`opus` readers move to the list/fast-model model. | Server services, desktop stores/components, tests, and the parallel-provider E2E fixture were updated. Intentional legacy object usage remains only in migration tests. | Source scan completed; affected focused tests passed. |
| 20 | `modelContextWindows` remains keyed by model ID. | Provider form context inputs and runtime lookup use each entry's `id`, never its display name. | Component/runtime tests passed; local model metadata confirmed all three tested Ollama models report a 262,144-token context length. |
| 21 | Context-window discovery from `/models` remains outside this issue. | No context-length inference was added. Manual context values and existing built-in fallback behavior remain. | Correctly deferred to Issue #105. |

## 3. Schema design

### 3.1 Provider model

```ts
const ProviderModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
})
```

- `id` is the exact upstream model identifier. It is required, trimmed, persisted, passed to the CLI, and sent upstream.
- `name` is optional UI metadata. It is never used for routing or upstream requests.
- An empty display name is normalized away, so the UI falls back to the ID.

### 3.2 Ordered model list

```ts
const ProviderModelsSchema = z.array(ProviderModelSchema).superRefine(...unique IDs...)
```

- Array order is meaningful.
- The first entry is the provider default.
- Saved and newly created providers require at least one entry.
- IDs must be unique within one provider; the same ID may appear in different providers.

### 3.3 Fast model

```ts
fastModel?: string
```

- The value is a model ID, not a display name or a nested model object.
- Service validation requires it to match one entry in the same provider.
- `null` in an update request explicitly clears it.
- If omitted, fast/background work uses the selected model.

### 3.4 Context-window mapping

```ts
modelContextWindows?: Record<string, number>
```

Keys remain upstream model IDs. Renaming a display name therefore does not detach its context-window configuration.

### 3.5 Discovery request and response

Unsaved-provider discovery accepts:

```ts
{
  baseUrl: string
  apiKey: string
  authStrategy?: ProviderAuthStrategy
  apiFormat: 'anthropic' | 'openai_chat' | 'openai_responses'
}
```

The server returns transient `ProviderModel[]` candidates. A saved provider can be discovered by ID without returning its stored API key to the UI.

### 3.6 Storage version and migration

Provider storage now uses schema version 2. A legacy object such as:

```json
{
  "main": "model-a",
  "sonnet": "model-b",
  "opus": "model-a",
  "haiku": "model-fast"
}
```

becomes:

```json
{
  "models": [
    { "id": "model-a" },
    { "id": "model-b" },
    { "id": "model-fast" }
  ],
  "fastModel": "model-fast"
}
```

The migration preserves first occurrence order and creates a pre-migration backup through the existing persistence upgrade mechanism.

## 4. Runtime mapping

| Purpose | Source | Environment variables |
| --- | --- | --- |
| Main session/task work | Selected model, otherwise provider first model | `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| Fast/background work | Provider fast model, otherwise selected model | `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL` |

Explicit application behavior using this mapping includes session startup/restart, title generation, and scheduled task launches. The Claude CLI can also consume the Haiku/Small Fast values for Explore and other lightweight internal work.

## 5. Main implementation areas

- `src/server/types/provider.ts`: provider model and discovery schemas
- `src/server/config/providerPresets.ts` and `.json`: list-based presets
- `src/server/services/persistentStorageMigrations.ts`: schema version 2 migration
- `src/server/services/providerRuntimeEnv.ts`: selected/fast role mapping
- `src/server/services/providerService.ts`: normalization, referential validation, and discovery
- `src/server/upstream/client.ts`: authenticated `/v1/models` fetch and parsing
- `src/server/api/providers.ts`: discovery API routes
- `src/server/api/models.ts`: all-provider model information
- `src/server/services/titleService.ts`: fast-model title generation
- `src/server/services/cronScheduler.ts`: scheduled task model selection
- `src/server/services/conversationService.ts` and `src/server/ws/handler.ts`: per-session runtime model
- `desktop/src/components/settings/ProviderFormModal.tsx`: model-list editor
- `desktop/src/components/controls/ModelSelector.tsx`: all-provider picker
- `desktop/src/stores/providerStore.ts` and `desktop/src/api/providers.ts`: discovery state/API
- `desktop/scripts/e2e-parallel-providers-agent-browser.sh`: schema version 2 fixture

## 6. Verification record

### 6.1 Automated verification

| Check | Result |
| --- | --- |
| Desktop TypeScript check on the PR branch | Passed |
| Targeted desktop tests on the PR branch | 139 passed, 4 skipped, 0 failed |
| Focused server tests on the PR branch | 170 passed, 3 skipped, 0 failed across provider, runtime, migration, preset, title, scheduler, settings, upstream, and proxy suites |
| Selected-model conversation environment test | 1/1 passed |
| Earlier WebSocket conversation integration run in the installed source workspace | 63/63 passed |
| Vite production build on the PR branch | Passed; 4,419 modules transformed |
| Windows sidecar compilation in the installed source workspace | Passed; 3,947 modules bundled |
| Updated E2E provider fixture JavaScript syntax | Passed |

The full desktop Vitest suite is not a green gate in this environment because module mocks fail broadly across unrelated MCP, session, chat, workspace, and terminal tests. The complete WebSocket file also depends on a globally discoverable Bun executable for its spawned mock CLI; the temporary PR worktree runner is not visible to those child processes. The Issue #120 component/store/server tests pass independently. These environment limitations must not be presented as a fully green repository-wide test run.

### 6.2 Successful manual validation: local Ollama only

The tester confirmed the Issue #120 manual flow succeeded with a local Ollama deployment.

| Item | Validated value |
| --- | --- |
| Platform | Windows x64 |
| Ollama version | 0.34.2 |
| Base URL | `http://127.0.0.1:11434` |
| Model discovery endpoint | `GET /v1/models` |
| Main/default model | `qwen3.8:latest` (27.3B, Q4_K_M) |
| Additional model | `qwen3.5:9b` (9.7B, Q4_K_M) |
| Fast model | `qwen3.5:4b` (4.7B, Q4_K_M) |
| Reported context length | 262,144 for all three models |
| Result | Provider configuration, model discovery/list editing, local model selection, persistence, and fast-model use passed |

The Ollama preset's default `qwen3.6:27b` was not installed locally and was removed during the manual configuration. The three IDs above came from the running Ollama `/v1/models` endpoint.

Ollama exposes compatibility endpoints, but this local run does **not** count as manual validation against a real OpenAI/OpenAI-compatible cloud service or the real Anthropic API.

### 6.3 Manual validation still pending

| Provider/API | Status | Required follow-up |
| --- | --- | --- |
| Real OpenAI or OpenAI-compatible cloud API | Pending | Fetch models with a real account, add/rename/switch models, verify upstream request IDs, title model, and error handling. |
| Real Anthropic API | Pending | Fetch models with Anthropic headers, switch models, verify selected and fast-model request IDs, title generation, and error handling. |
| Legacy provider migration on an existing user profile | Pending manual check | Automated migration tests pass; perform a backed-up real-profile upgrade if required before release. |

Mocked tests exercise both OpenAI-compatible and Anthropic discovery/authentication paths, but mocks are not a substitute for real remote API acceptance.

## 7. Pull request readiness

Suggested PR title:

```text
feat(providers): support arbitrary model lists and optional fast models
```

Before merge, reviewers should:

- Review the schema version 2 migration and backup behavior.
- Review that every upstream path uses model IDs rather than display names.
- Decide whether real OpenAI and Anthropic manual validation is required before merge or may follow afterward.
- Keep Issue #105 context-window discovery explicitly out of scope.
- Record the full-suite Vitest mock limitation separately from Issue #120's focused results.

This report is committed with the Issue #120 feature branch and accompanies its pull request. Commit and PR identifiers are kept in Git/GitHub metadata rather than embedded in the report.
