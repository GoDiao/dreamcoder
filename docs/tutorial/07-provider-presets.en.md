# Adding a provider preset

This guide covers adding a provider to DreamCoder's built-in provider list. It follows the preset from its JSON definition to the settings form and the connection test. It does not add a new API protocol or change how the provider runtime works.

The source references below are pinned to commit [`75d9b3b`](https://github.com/GoDiao/dreamcoder/tree/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f). Check the current source before using the examples in a later revision.

## Find the preset contract

Built-in presets are listed in [`src/server/config/providerPresets.json`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/config/providerPresets.json). The server imports that file and parses it with the Zod schema in [`providerPresets.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/config/providerPresets.ts). The schema checks every preset when the module loads; an invalid entry prevents the preset list from loading.

Each entry describes a provider endpoint and model defaults:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable identifier used to associate a saved provider with its preset. |
| `name` | yes | Name shown in the settings form. |
| `baseUrl` | yes | Provider API endpoint. |
| `apiFormat` | yes | One of `anthropic`, `openai_chat`, or `openai_responses`. |
| `defaultModels` | yes | Initial model IDs, optionally with display names. IDs must be non-empty and unique. |
| `defaultFastModel` | no | Initial fast model; use an ID present in `defaultModels`. |
| `needsApiKey` | yes | Whether the form requires the user to enter a key before saving or testing. |
| `websiteUrl` | yes | Provider website. |
| `apiKeyUrl` | no | Direct link to the provider's key-management page. |
| `authStrategy` | no | Authentication mapping for the selected API format. |
| `defaultEnv` | no | Non-secret environment defaults passed through the provider configuration. Never put a real API key or other secret here. |
| `modelContextWindows` | no | Known context-window sizes keyed by model ID. Values must be integers from 16,000 through 10,000,000. |

The accepted API formats and authentication strategies are defined in [`src/server/types/provider.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/types/provider.ts). A preset only selects these existing behaviors; adding a format or a new authentication flow is a separate runtime change.

## Add an entry

Before editing, confirm the base URL, API format, authentication requirements, model IDs, and any context-window values from the provider's own documentation. Only include defaults that are stable and supported by those sources. Do not infer a model ID or context size from a marketing name.

Add the entry to `providerPresets.json`. For example, this abbreviated shape shows the required fields; replace every illustrative value with verified provider information:

```json
{
  "id": "example-provider",
  "name": "Example Provider",
  "baseUrl": "https://api.example.invalid/v1",
  "apiFormat": "openai_chat",
  "defaultModels": [{ "id": "example-model" }],
  "needsApiKey": true,
  "websiteUrl": "https://example.invalid",
  "apiKeyUrl": "https://example.invalid/api-keys",
  "authStrategy": "api_key"
}
```

The `.invalid` domain and model ID above are placeholders, not a real provider configuration. Keep the built-in `custom` preset last in the array; the current tests also pin the local LM Studio and Ollama entries immediately before it.

Use an explicit `authStrategy` when the provider requires behavior other than the form's default. `defaultEnv` is appropriate for non-secret compatibility settings, not credentials. Users enter their own key in the form. Never commit a real key in the preset, examples, screenshots, or test fixtures.

## Update preset tests

Extend [`src/server/__tests__/provider-presets.test.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/__tests__/provider-presets.test.ts) to find the new ID and assert its documented URL, API format, initial models, and any optional defaults you added. The test file already checks that `GET /api/providers/presets` returns the configured list and that selected provider defaults match their published details. Keep the `custom` ordering assertions intact.

The form reads this same list from `GET /api/providers/presets`. Selecting a preset copies its URL, API format, authentication strategy, initial models, fast model, and any known context windows into the form. The UI behavior lives in [`ProviderFormModal.tsx`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/desktop/src/components/settings/ProviderFormModal.tsx); no separate UI registry is needed for a normal preset.

Run the focused server test from the repository root:

```bash
bun test ./src/server/__tests__/provider-presets.test.ts
```

If the change alters how users select or authenticate a provider, also update the relevant desktop tests in `desktop/src/components/settings/ProviderFormModal.test.tsx` and run them from `desktop`:

```bash
bun run test -- --run src/components/settings/ProviderFormModal.test.tsx
```

## Test a connection in the app

To exercise the manual flow, start DreamCoder and open **Settings → Providers → Add provider**. Select the new preset, enter a valid key if it requires one, and make sure the first model in the form is enabled by that account. Choose **Test Connection** before saving.

The form sends the current unsaved URL, API format, authentication strategy, key, and first model to `POST /api/providers/test`. The server validates the request and asks `ProviderService` to send a short streaming request to that model and read its response. A successful result confirms that this configuration can reach the selected model; it does not verify every model in the list or a complete coding-agent session. If model discovery is supported for that endpoint, **Discover models** is a separate operation and can help populate the list.

Do not paste real API keys into issue comments, pull requests, screenshots, or logs. Use a personal key only in the local settings form, and remove or rotate it if it was exposed.

## Checklist

- The preset uses provider-documented endpoint and model values.
- Optional auth, environment, and context-window fields are justified by the existing schema.
- The preset test asserts the new entry and preserves required ordering.
- The focused server test passes; relevant desktop checks pass if form behavior changed.
- The connection test succeeds locally, or the PR explains why it could not be run.
- No credentials or other secrets are included in the change.
