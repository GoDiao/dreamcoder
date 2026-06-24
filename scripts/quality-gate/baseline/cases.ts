import type { BaselineCase } from '../types'

export const baselineCases: BaselineCase[] = [
  {
    id: 'failing-unit',
    title: 'Fix a failing unit test',
    description: 'A tiny TypeScript project has a broken arithmetic function. The Agent must inspect the failing test, patch the implementation, and rerun the test.',
    fixture: 'scripts/quality-gate/baseline/fixtures/failing-unit',
    prompt: 'Run the tests, inspect the failing assertion, fix the implementation bug, and rerun the tests until they pass. Only modify the fixture source files needed for the fix.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell'],
    timeoutMs: 180_000,
    verify: {
      commands: [['bun', 'test']],
      requiredFiles: ['src/math.ts'],
      expectedFiles: ['src/math.ts'],
      forbiddenFiles: ['package.json'],
      transcriptAssertions: ['"type":"message_complete"'],
    },
  },
  {
    id: 'multi-file-api',
    title: 'Update a multi-file API contract',
    description: 'A small app exposes a user display API. The Agent must change the contract and update callers coherently without loosening tests.',
    fixture: 'scripts/quality-gate/baseline/fixtures/multi-file-api',
    prompt: 'The user display API contract changed to return an object with a label field, where label is "Ada Lovelace <ada@example.com>". Update the implementation and caller so the existing tests pass. Do not edit package.json.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell'],
    timeoutMs: 240_000,
    verify: {
      commands: [['bun', 'test']],
      requiredFiles: ['src/api.ts', 'src/app.ts'],
      expectedFiles: ['src/api.ts', 'src/app.ts', 'src/app.test.ts'],
      forbiddenFiles: ['package.json'],
      transcriptAssertions: ['"type":"message_complete"'],
    },
  },
  {
    id: 'failure-recovery',
    title: 'Recover from a deeper failing test suite',
    description: 'A slug formatter has several edge-case failures. The Agent must read the failures, patch the implementation, and keep tests unchanged.',
    fixture: 'scripts/quality-gate/baseline/fixtures/failure-recovery',
    prompt: 'Run the tests and fix the slug formatter implementation until the whole suite passes. Do not edit the tests. Keep the implementation small and deterministic.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell'],
    timeoutMs: 240_000,
    verify: {
      commands: [['bun', 'test']],
      requiredFiles: ['src/slug.ts'],
      expectedFiles: ['src/slug.ts'],
      forbiddenFiles: ['src/slug.test.ts', 'package.json'],
      transcriptAssertions: ['"type":"message_complete"'],
    },
  },
  {
    id: 'workspace-search-edit',
    title: 'Find and fix a bug across a small workspace',
    description: 'A checkout total is wrong in a multi-file fixture. The Agent must inspect the workspace and patch the correct implementation file.',
    fixture: 'scripts/quality-gate/baseline/fixtures/workspace-search-edit',
    prompt: 'The checkout tests are failing. Search the project, identify the real bug, fix the implementation, and rerun the tests. Do not rewrite unrelated modules.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell'],
    timeoutMs: 240_000,
    verify: {
      commands: [['bun', 'test']],
      requiredFiles: ['src/checkout.ts'],
      expectedFiles: ['src/checkout.ts'],
      forbiddenFiles: ['src/checkout.test.ts', 'src/catalog.ts', 'src/user.ts', 'package.json'],
      transcriptAssertions: ['"type":"message_complete"'],
    },
  },
  {
    id: 'permission-artifact',
    title: 'Create a required project artifact',
    description: 'A test expects a generated summary file. The Agent must create a new file and validate it without changing the test.',
    fixture: 'scripts/quality-gate/baseline/fixtures/permission-artifact',
    prompt: 'Run the tests, create the missing project artifact they require, and rerun the tests. Do not modify the tests or package.json.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell', 'permission'],
    timeoutMs: 180_000,
    verify: {
      commands: [['bun', 'test']],
      requiredFiles: ['notes/summary.md'],
      expectedFiles: ['notes/summary.md'],
      forbiddenFiles: ['src/artifact.test.ts', 'package.json'],
      transcriptAssertions: ['"type":"message_complete"'],
    },
  },
  {
    id: 'cross-module-refactor',
    title: 'Complete a cross-module parser refactor',
    description: 'A config parser contract changed but the implementation and caller are stale. The Agent must update multiple modules coherently.',
    fixture: 'scripts/quality-gate/baseline/fixtures/cross-module-refactor',
    prompt: 'Update the config parsing flow so parseConfig returns a structured object with enabled and retries fields. Update the implementation and caller so the existing tests pass, then run the suite.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell'],
    timeoutMs: 300_000,
    verify: {
      commands: [['bun', 'test']],
      requiredFiles: ['src/config.ts', 'src/runner.ts'],
      expectedFiles: ['src/config.ts', 'src/runner.ts', 'src/runner.test.ts'],
      forbiddenFiles: ['package.json'],
      transcriptAssertions: ['"type":"message_complete"'],
    },
  },
]

export function validateBaselineCases(cases = baselineCases) {
  const ids = new Set<string>()

  for (const testCase of cases) {
    if (ids.has(testCase.id)) {
      throw new Error(`Duplicate baseline case id: ${testCase.id}`)
    }
    ids.add(testCase.id)

    if (!testCase.fixture) {
      throw new Error(`Baseline case ${testCase.id} is missing a fixture`)
    }
    if (testCase.verify.commands.length === 0) {
      throw new Error(`Baseline case ${testCase.id} is missing verification commands`)
    }
    if (testCase.timeoutMs < 30_000) {
      throw new Error(`Baseline case ${testCase.id} timeout is too low`)
    }
  }
}
