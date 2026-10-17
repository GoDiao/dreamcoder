// DreamCoder inherits customizations from Claude Code's directory. Tests must not
// read the developer's real one, and os.homedir() ignores a HOME set mid-test, so
// point it at a missing directory unless the run sets it.
process.env.CLAUDE_CONFIG_DIR ??= '/nonexistent/claude-code-config'
