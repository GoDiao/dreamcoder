/** Set for CLI children when Settings → General → Agent teams is on (#134). */
export const AGENT_TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'

/**
 * The desktop switch decides whether sessions and scheduled tasks get agent
 * teams, so a value inherited from the shell is dropped first. A `settings.json`
 * `env` block can still set it, as for any other variable.
 */
export function applyAgentTeamsSetting(
  env: Record<string, string | undefined>,
  userSettings: Record<string, unknown>,
): void {
  delete env[AGENT_TEAMS_ENV]
  if (userSettings.agentTeamsEnabled === true) env[AGENT_TEAMS_ENV] = '1'
}
