export const DESCRIPTION = 'Copy an artifact from another location into the dc_artifacts/ folder of your current working directory so you can edit it.'

export const PROMPT = `Artifacts outside your current working directory (another project, another worktree, or the global store) are read-only. This tool copies one into dc_artifacts/ of your current working directory, after the user confirms. Edit the copy afterwards.

Pass the path of the artifact folder (.../dc_artifacts/<name>). If the artifact came from the global store it is moved: the global copy is removed once the new copy is verified. If it came from another working directory it is copied and the original stays where it was. If the name is already taken a number is added to the name. The result gives the new path.`
