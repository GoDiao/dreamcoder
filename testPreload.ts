import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// DreamCoder inherits customizations from Claude Code's directory. Tests must not
// read the developer's real one, and os.homedir() ignores a HOME set mid-test, so
// point it at a missing directory unless the run sets it.
process.env.CLAUDE_CONFIG_DIR ??= '/nonexistent/claude-code-config'

// Tests that do not set DreamCoder's own directory must not write to the
// developer's real ~/.dreamcoder either.
if (!process.env.DREAMCODER_CONFIG_DIR) {
  const configDir = mkdtempSync(join(tmpdir(), 'dreamcoder-test-config-'))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  afterAll(() => rmSync(configDir, { recursive: true, force: true }))
}
