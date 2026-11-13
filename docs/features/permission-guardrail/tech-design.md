# Permission guardrail technical design

## Purpose

Auto permission mode reduces confirmation prompts without weakening deterministic permission rules. Rules run first. Calls that rules do not allow or deny are evaluated by a configured model, and only calls that the model does not allow are shown to the user.

The feature is opt-in because the evaluation can send the user request, recent tool context, tool input, and working directory to a hosted provider.

## Scope

The first release provides:

- an `auto` permission mode in the CLI, server protocol, desktop selector, and persisted settings;
- separate decision-provider records under Providers;
- a fallback to the active model provider when no decision provider is selected;
- fail-safe model evaluation after deterministic rules;
- persistent transcript markers for model-assisted decisions;
- desktop settings and permission cards in English and Chinese.

It does not provide a structured editor for user or project permission rules. Those rules remain in the existing settings files, including project-local `.claude/settings.local.json`.

## Permission pipeline

Auto follows this order:

1. Load the effective user, project, command-line, and session permission rules.
2. Run tool-level and content-specific permission checks.
3. Return any deterministic deny without calling a model.
4. Return any deterministic allow without calling a model.
5. Evaluate the unresolved confirmation with the configured decision source.
6. Allow when a supported policy returns allow; otherwise ask the user.

Bypass-immune checks remain before model evaluation. The model can return only allow or ask. It cannot deny a call, override a deny rule, or bypass a bypass-immune check.

Manual, Accept edits, Plan, and Bypass permissions do not call the decision model. Bypass retains its existing meaning of skipping ordinary prompts while still respecting deterministic deny and bypass-immune checks.

## Configuration ownership

The sidecar owns provider configuration and Auto settings.

Decision providers are stored separately from normal model providers in the provider index:

```ts
type ProvidersIndex = {
  activeId: string | null
  providers: SavedProvider[]
  decisionProviders: SavedDecisionProvider[]
}
```

Each decision provider owns its endpoint, API format, deployment classification, credential, and model list. Auto settings reference a decision provider and model, or use `providerId: null` for the active model-provider fallback:

```ts
type AutoPermissionSettings = {
  providerId: string | null
  modelId: string
  privacyNoticeVersion: number
}
```

There is no global active decision provider. The selected source belongs to Auto settings. API keys follow the existing provider persistence path and are not added to session state, WebSocket messages, logs, or transcripts.

## Decision sources

### Decision provider

A decision provider may use OpenAI Decisions, OpenRouter Decisions, OpenAI-compatible chat, or Ollama chat transport. Automatic allow is enabled only when the provider-format and model pair has a policy defined in code. Unsupported pairs return ask.

The validated policy is `openai_decisions:gpt-6-luna`, with ask threshold `0.5` and policy version `1`. Its predicate estimates whether the user should be asked before the tool call runs.

Jev, d1-ultra, Claude models, and chat-based local models have not been validated end to end in DreamCoder. Their thresholds must be selected independently on SABER dev data and evaluated once on the test split. They do not inherit the GPT-6 Luna threshold.

### Active provider fallback

When Auto has no decision provider, the sidecar uses the active model provider. It selects the provider's explicit `fastModel` when present and otherwise its selected model. The model receives a fixed policy and a forced structured response with `behavior: allow | ask` and an optional reason.

The fallback does not invent a probability score. Its transcript marker stores `score: null`. A missing active provider, missing model, invalid structured response, request error, or timeout returns ask.

## Privacy and endpoint classification

Hosted evaluation requires acceptance of the current privacy notice. Only verified loopback endpoints are treated as local/private. A custom LAN or public URL remains external even when its provider is labeled custom.

The policy and response options are fixed in code. Tool output is attacker-controlled context and cannot change the deterministic rule result or the fail-safe behavior.

## Session state and protocol

The CLI includes model details in the structured permission request only when Auto returns ask. The server validates those details before adding them to `PendingPermission.guardrail`. The existing `alwaysAsks` flag remains independent and may appear on the same request.

`pendingPermissions` is ordered. The desktop renders only the first request as active, then activates the next request after the first closes. This prevents concurrent tool execution from presenting several actionable cards at once while preserving every server-owned request.

The model decision marker is emitted as a transcript attachment and translated into a live transcript item containing:

- provider and model identifiers;
- decision source;
- allow or ask decision;
- score when the transport supplies one;
- policy version;
- optional reason and tool-use identifier.

Permission markers are loggable for external users and are reconstructed by transcript history after restart. They coexist with queued-command attachments introduced by session links. Messages sent during an active turn continue to use the server-owned queue and do not bypass or replace pending permission state.

## Desktop behavior

Providers contains a separate Permission guardrail providers section with connection testing and model discovery. Fetching models refreshes suggestions without overwriting a manually entered model identifier.

Permissions lists Auto as a fifth mode. Selecting it shows the decision source, model, privacy notice, fixed-policy explanation, and a link to provider configuration. The permission card shows validated guardrail details when the model returns ask. Transcript markers show model-assisted allow and ask outcomes after history reload.

The desktop `/permissions` command opens Permission settings. Rule help names the project-local settings file and explains that shell rules are tool-specific, including separate `Bash(...)` and `PowerShell(...)` forms.

## Failure behavior

The following conditions return ask:

- missing provider or model;
- missing hosted-provider credentials;
- privacy notice not accepted;
- unsupported provider-format and model policy;
- timeout, network error, or non-success response;
- invalid probability or structured response;
- input serialization failure.

No failure path becomes allow.

## Verification

Automated coverage includes threshold boundaries, errors and malformed results, deterministic Bash and PowerShell denies, bypass-immune checks, mode isolation, provider fallback, structured protocol translation, concurrent request activation, transcript persistence, settings validation, and English and Chinese desktop settings.

Manual acceptance uses a new session after permission-rule edits and verifies the actual shell tool name displayed by the tool card. OpenAI Decisions with `gpt-6-luna` is the only provider/model combination currently validated end to end.
